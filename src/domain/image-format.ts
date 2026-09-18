/**
 * Reconnaissance et assainissement d'images — **TypeScript pur**.
 *
 * POURQUOI CE MODULE EST DANS `src/domain/`
 * (a) Les CONVENTIONS §2 imposent que `src/domain/` ne fasse que des
 *     entrées/sorties de données : ici, on prend des octets et on rend des
 *     octets. Aucun `fs`, aucun Prisma, aucun `process.env`, aucune horloge.
 *     Le module est donc testable sans base et sans mock.
 * (b) C'est du code de SÉCURITÉ : le tester unitairement, octet par octet,
 *     est plus rentable que de le tester à travers une route HTTP.
 *
 * POURQUOI ÇA EXISTE (risque R6 de KNOWN-ISSUES : « téléversement = surface
 * d'attaque et remplissage de disque »)
 *
 * 1. `sniffImageMime` ne regarde QUE les octets de signature (magic bytes) du
 *    fichier. Ni l'extension, ni le `Content-Type` envoyé par le client ne
 *    font foi : les deux se falsifient en une ligne de curl (`-F
 *    "file=@payload.html;type=image/png"`). Le contrôle client est un confort
 *    d'interface, jamais la sécurité.
 * 2. `readImageDimensions` lit les dimensions RÉELLES dans l'en-tête. Deux
 *    usages : (i) réserver la place au rendu — sans dimensions, la page saute
 *    à l'arrivée de chaque image, très visible en 3G ; (ii) borner le nombre
 *    de pixels, ce qui bloque la « bombe de décompression » : un PNG de 50 ko
 *    peut annoncer 60 000 × 60 000 pixels, soit ~14 Go de mémoire au décodage.
 *    Le plafond est vérifié AVANT tout décodage.
 * 3. `sanitizeImage` réécrit le fichier avant écriture disque : les octets
 *    téléversés ne sont JAMAIS ceux servis. C'est le contrôle qui neutralise
 *    les charges utiles planquées dans les métadonnées (commentaires HTML,
 *    profils ICC, miniatures EXIF, XMP…).
 */

/** Types d'image acceptés. Liste blanche fermée : tout le reste est refusé. */
export type AllowedImageMime = "image/jpeg" | "image/png" | "image/webp";

/** Types acceptés, dans l'ordre où l'interface les annonce au navigateur. */
export const ALLOWED_IMAGE_MIMES: readonly AllowedImageMime[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Extension de fichier associée au type.
 *
 * Le nom de fichier écrit sur disque est TOUJOURS `<identifiant généré>.<ext>`
 * où `ext` vient d'ici — donc du type détecté dans les octets. Conséquence
 * recherchée : l'extension et le type MIME stocké en base ne peuvent pas
 * diverger, et le serveur statique annoncera un `Content-Type` cohérent même
 * sans configuration supplémentaire.
 */
export function extensionForMime(mime: AllowedImageMime): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}

/** Octets de signature (magic bytes) de chaque format accepté. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function matchesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || bytes.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Type réel du fichier, déduit de ses octets de tête — ou `null` si ce n'est
 * pas un JPEG, un PNG ou un WebP.
 *
 * Un SVG renvoie `null` : c'est un format XML qui peut porter du `<script>`,
 * donc du code exécuté dans l'origine de la boutique s'il est servi. Il est
 * refusé même téléversé sous un autre nom.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (matchesAt(bytes, 0, JPEG_MAGIC)) return "image/jpeg";
  if (matchesAt(bytes, 0, PNG_MAGIC)) return "image/png";
  // Un WebP est un conteneur RIFF : « RIFF » + taille (4 octets) + « WEBP ».
  // Le trou de 4 octets est la taille du fichier, on ne peut pas la comparer
  // de façon fiable (certains encodeurs la laissent à zéro) : on vérifie donc
  // les deux marqueurs, ce qui suffit à distinguer d'un WAV ou d'un AVI.
  if (matchesAt(bytes, 0, RIFF_MAGIC) && matchesAt(bytes, 8, WEBP_MAGIC)) return "image/webp";
  return null;
}

/**
 * `true` si le contenu ressemble à du SVG/XML.
 *
 * Sert uniquement à produire un message d'erreur qui EXPLIQUE le refus
 * (« le format SVG n'est pas accepté car il peut contenir du code ») plutôt
 * qu'un « type non supporté » que le marchand ne peut pas interpréter.
 * On tolère un BOM UTF-8, des espaces et une déclaration XML avant la balise.
 */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  // Les 8 premiers octets sont déjà connus comme « pas un JPEG/PNG/WebP »
  // quand on appelle cette fonction : inutile de chercher plus loin.
  const window = bytes.subarray(0, 512);

  // On saute en OCTETS le BOM UTF-8 (EF BB BF) puis les blancs ASCII. Le faire
  // après décodage serait un piège : les trois octets du BOM deviennent trois
  // caractères « ï»¿ » si on les convertit naïvement un par un.
  let start = 0;
  if (window.length >= 3 && window[0] === 0xef && window[1] === 0xbb && window[2] === 0xbf) {
    start = 3;
  }
  while (
    start < window.length &&
    (window[start] === 0x20 || window[start] === 0x09 || window[start] === 0x0a || window[start] === 0x0d)
  ) {
    start += 1;
  }
  if (window[start] !== 0x3c /* "<" */) return false;

  let text = "";
  for (let i = start; i < Math.min(window.length, start + 128); i += 1) {
    text += String.fromCharCode(window[i]!);
  }
  const cleaned = text.toLowerCase();
  return (
    cleaned.startsWith("<svg") ||
    cleaned.startsWith("<?xml") ||
    cleaned.startsWith("<!doctype svg")
  );
}

/** Dimensions déclarées dans l'en-tête du fichier. */
export interface ImageDimensions {
  width: number;
  height: number;
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

/** Marqueurs JPEG qui portent les dimensions (SOF : Start Of Frame). */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Lit les dimensions réelles de l'image, ou `null` si l'en-tête est
 * illisible/tronqué.
 *
 * On ne décode PAS les pixels : on lit l'en-tête. C'est volontaire — décoder
 * une « bombe de décompression » pour connaître ses dimensions serait
 * exactement le déni de service qu'on cherche à empêcher. Ces valeurs sont
 * celles que le navigateur utilisera pour réserver la place au rendu.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mime: AllowedImageMime,
): ImageDimensions | null {
  switch (mime) {
    case "image/png":
      return readPngDimensions(bytes);
    case "image/jpeg":
      return readJpegDimensions(bytes);
    case "image/webp":
      return readWebpDimensions(bytes);
  }
}

/** PNG : IHDR est TOUJOURS le premier chunk, largeur/hauteur en 32 bits BE. */
function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  // 8 (signature) + 4 (longueur) + 4 (type "IHDR") + 8 (w/h) = 24 octets.
  if (bytes.length < 24) return null;
  const isIhdr =
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!isIhdr) return null;
  const width = readUInt32BE(bytes, 16);
  const height = readUInt32BE(bytes, 20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * JPEG : on parcourt les segments jusqu'au premier SOFn.
 *
 * Chaque segment commence par 0xFF <marqueur> ; sauf SOI/EOI/RSTn/TEM qui
 * n'ont pas de champ longueur, les autres portent une longueur sur 2 octets
 * (longueur incluse, donc ≥ 2). Le SOFn porte : précision (1 octet), hauteur
 * (2 octets), largeur (2 octets).
 */
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2; // on saute le SOI (FF D8)
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null; // flux désynchronisé
    let marker = bytes[offset + 1]!;
    // Octets de bourrage 0xFF autorisés entre deux segments.
    while (marker === 0xff) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // marqueur sans longueur
      continue;
    }
    if (marker === 0xd9) return null; // EOI atteint sans SOF : fichier invalide
    const length = readUInt16BE(bytes, offset + 2);
    if (length < 2) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 9 >= bytes.length) return null;
      const height = readUInt16BE(bytes, offset + 5);
      const width = readUInt16BE(bytes, offset + 7);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

/** WebP : trois sous-formats possibles, chacun avec son en-tête de taille. */
function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  // 12 octets d'en-tête RIFF/WEBP, puis fourcc (4) + taille (4).
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!,
    );
    const size = readUInt16LE(bytes, offset + 4) | (readUInt16LE(bytes, offset + 6) << 16);
    const data = offset + 8;
    if (fourcc === "VP8X") {
      if (data + 10 > bytes.length) return null;
      const width = readUInt24LE(bytes, data + 4) + 1;
      const height = readUInt24LE(bytes, data + 7) + 1;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (fourcc === "VP8L") {
      if (data + 5 > bytes.length || bytes[data] !== 0x2f) return null;
      const bits =
        ((bytes[data + 1]! | (bytes[data + 2]! << 8) | (bytes[data + 3]! << 16) | (bytes[data + 4]! << 24)) >>> 0);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }
    if (fourcc === "VP8 ") {
      // VP8 (avec espace) : 3 octets de frame tag, puis le start code
      // 0x9D 0x01 0x2A, puis largeur et hauteur sur 14 bits chacune.
      if (data + 10 > bytes.length) return null;
      if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        return null;
      }
      const width = readUInt16LE(bytes, data + 6) & 0x3fff;
      const height = readUInt16LE(bytes, data + 8) & 0x3fff;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    // Chunk sans rapport (ALPH, EXIF, ICCP…) : on saute. La taille d'un chunk
    // RIFF est paire, complétée d'un octet de bourrage si nécessaire.
    offset = data + size + (size % 2);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Assainissement « l'original n'est jamais servi »
// ─────────────────────────────────────────────────────────────────────

/**
 * Réécrit l'image en ne conservant que ce qui est nécessaire pour l'afficher.
 *
 * CE QUE ÇA BLOQUE, CONCRÈTEMENT
 *  - les métadonnées (EXIF/GPS/XMP/commentaires/profils ICC, chunks PNG
 *    `tEXt`/`zTXt`/`iTXt`/`eXIf`, segments JPEG `APPn`/`COM`, chunks WebP
 *    `EXIF`/`XMP `/`ICCP`) : c'est là que se planquent les charges utiles, et
 *    c'est aussi là que fuiteraient les coordonnées GPS de chez la marchande ;
 *  - les octets d'origine eux-mêmes : ce qu'on sert sur le site n'a jamais
 *    transité tel quel depuis le téléphone.
 *
 * SEULE MÉTADONNÉE CONSERVÉE : l'orientation EXIF, réécrite dans un segment
 * minimal qui ne contient QUE cette valeur. Sans elle, une photo prise en
 * portrait s'affiche couchée (les navigateurs n'appliquent l'orientation que
 * si l'information existe). On garde donc l'utile, on jette le reste — dont
 * les coordonnées GPS.
 *
 * HONNÊTETÉ SUR LA PORTÉE : il s'agit d'une réécriture de conteneur, pas d'un
 * ré-encodage des pixels. Le ré-encodage pixel (changer la compression, la
 * taille physique de l'image) exige un codec (`sharp`), donc une dépendance,
 * donc une ADR au titre des CONVENTIONS §9 — décision qui ne revient pas à
 * cette carte. Ce que la réécriture garantit est déjà l'essentiel du risque
 * R6 : aucun octet téléversé n'est servi, aucune métadonnée n'est exposée.
 */
export function sanitizeImage(bytes: Uint8Array, mime: AllowedImageMime): Uint8Array {
  switch (mime) {
    case "image/png":
      return sanitizePng(bytes);
    case "image/jpeg":
      return sanitizeJpeg(bytes);
    case "image/webp":
      return sanitizeWebp(bytes);
  }
}

/**
 * Orientation EXIF déclarée par l'image, ou `null`.
 *
 * POURQUOI C'EST EXPOSÉ : le serveur réécrit l'image en ne conservant QUE
 * cette valeur. Il faut donc pouvoir la relire après coup — pour les tests,
 * et pour diagnostiquer une photo qui s'affiche couchée en production.
 */
export function readImageOrientation(
  bytes: Uint8Array,
  mime: AllowedImageMime,
): number | null {
  switch (mime) {
    case "image/jpeg":
      return readJpegExifOrientation(bytes);
    case "image/webp":
      return readWebpExifOrientation(bytes);
    case "image/png":
      return null; // l'orientation EXIF n'a pas de sens en PNG (pas de rotation)
  }
}

/** Chunks PNG conservés : ceux sans lesquels l'image ne s'affiche pas. */
const PNG_KEPT_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

function sanitizePng(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < PNG_MAGIC.length; i += 1) out.push(PNG_MAGIC[i]!);

  let offset = PNG_MAGIC.length;
  while (offset + 12 <= bytes.length) {
    const length = readUInt32BE(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4; // + CRC
    if (chunkEnd > bytes.length) break; // chunk tronqué : on s'arrête proprement
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    if (PNG_KEPT_CHUNKS.has(type)) {
      // Chunk recopié tel quel : le CRC fourni par l'encodeur reste donc
      // valide, on n'a pas à le recalculer (et donc pas de risque de le
      // calculer faux).
      for (let i = offset; i < chunkEnd; i += 1) out.push(bytes[i]!);
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }
  return Uint8Array.from(out);
}

function sanitizeJpeg(bytes: Uint8Array): Uint8Array {
  const orientation = readJpegExifOrientation(bytes);
  const out: number[] = [0xff, 0xd8];
  // On replace l'orientation tout de suite après SOI : c'est là que les
  // décodeurs attendent l'EXIF, et ça évite de la noyer après les tables.
  if (orientation !== null && orientation > 1) {
    pushExifSegment(out, orientation);
  }

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    if (marker === 0xda) {
      // SOS : tout ce qui suit est le flux entropique, jusqu'à la fin du
      // fichier. On le recopie d'un bloc (il contient l'EOI).
      for (let i = offset; i < bytes.length; i += 1) out.push(bytes[i]!);
      return Uint8Array.from(out);
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      return Uint8Array.from(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      offset += 2;
      continue;
    }
    const length = readUInt16BE(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    const isMetadata =
      marker === 0xfe /* COM */ || (marker >= 0xe0 && marker <= 0xef) /* APP0..APP15 */;
    if (!isMetadata) {
      for (let i = offset; i < offset + 2 + length; i += 1) out.push(bytes[i]!);
    }
    offset += 2 + length;
  }
  return Uint8Array.from(out);
}

/** Chunks WebP conservés : les données image et les métadonnées structurelles. */
const WEBP_KEPT_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

function sanitizeWebp(bytes: Uint8Array): Uint8Array {
  const orientation = readWebpExifOrientation(bytes);
  const kept: Uint8Array[] = [];

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!,
    );
    const size = readUInt16LE(bytes, offset + 4) | (readUInt16LE(bytes, offset + 6) << 16);
    const dataEnd = offset + 8 + size;
    if (dataEnd > bytes.length) break;
    if (WEBP_KEPT_CHUNKS.has(fourcc)) {
      // Un chunk RIFF a TOUJOURS une taille paire : si la charge est impaire,
      // un octet de bourrage la suit. On le recopie explicitement — sans lui,
      // l'en-tête de taille et la position réelle des chunks suivants
      // divergent d'un octet, et l'image devient illisible (constaté : le
      // chunk suivant était lu « XIF » au lieu de « EXIF »).
      const padding = size % 2;
      const chunk = new Uint8Array(8 + size + padding);
      chunk.set(bytes.subarray(offset, dataEnd), 0);
      if (fourcc === "VP8X") {
        // Le drapeau VP8X annonce la présence d'ICCP/EXIF/XMP. Comme on jette
        // ces chunks, il faut décocher leurs drapeaux : un fichier qui
        // annonce un profil ICC absent est un fichier invalide.
        // Bits (du plus fort au plus faible) : R R I L E X A R
        //   I = ICCP (0x20), L = ALPH (0x10), E = EXIF (0x08), X = XMP (0x04).
        const flags = chunk[8]! & ~0x20 & ~0x04;
        chunk[8] = orientation !== null && orientation > 1 ? flags | 0x08 : flags & ~0x08;
      }
      kept.push(chunk);
    }
    offset = dataEnd + (size % 2);
  }

  const hasVp8x = kept.some(
    (chunk) => String.fromCharCode(chunk[0]!, chunk[1]!, chunk[2]!, chunk[3]!) === "VP8X",
  );
  if (orientation !== null && orientation > 1 && hasVp8x) {
    // Un chunk RIFF : fourcc (4) + taille (4 LE) + données + bourrage pair.
    const payload = buildExifPayload(orientation);
    kept.push(buildRiffChunk("EXIF", payload));
  }

  const bodyLength = kept.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(12 + bodyLength);
  out.set(RIFF_MAGIC, 0);
  // La taille RIFF compte « WEBP » + tous les chunks (soit 4 + bodyLength).
  const riffSize = 4 + bodyLength;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >> 24) & 0xff;
  out.set(WEBP_MAGIC, 8);
  let cursor = 12;
  for (const chunk of kept) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

function buildRiffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const padded = payload.length + (payload.length % 2);
  const chunk = new Uint8Array(8 + padded);
  for (let i = 0; i < 4; i += 1) chunk[i] = fourcc.charCodeAt(i);
  chunk[4] = payload.length & 0xff;
  chunk[5] = (payload.length >> 8) & 0xff;
  chunk[6] = (payload.length >> 16) & 0xff;
  chunk[7] = (payload.length >> 24) & 0xff;
  chunk.set(payload, 8);
  return chunk;
}

// ─────────────────────────────────────────────────────────────────────
// EXIF : lecture de l'orientation, écriture d'un EXIF minimal
// ─────────────────────────────────────────────────────────────────────

/** Tag EXIF de l'orientation (0x0112). */
const EXIF_ORIENTATION_TAG = 0x0112;

/**
 * Lit l'orientation EXIF d'un segment APP1 / d'un chunk EXIF WebP.
 * Renvoie `null` si absente ou illisible — on ne devine pas.
 */
function readExifOrientation(payload: Uint8Array): number | null {
  if (!matchesAt(payload, 0, EXIF_HEADER)) return null;
  const tiff = 6;
  if (payload.length < tiff + 8) return null;
  const littleEndian =
    payload[tiff] === 0x49 && payload[tiff + 1] === 0x49
      ? true
      : payload[tiff] === 0x4d && payload[tiff + 1] === 0x4d
        ? false
        : null;
  if (littleEndian === null) return null;

  const read16 = (at: number): number =>
    littleEndian
      ? (payload[at] ?? 0) | ((payload[at + 1] ?? 0) << 8)
      : ((payload[at] ?? 0) << 8) | (payload[at + 1] ?? 0);
  const read32 = (at: number): number =>
    littleEndian
      ? ((payload[at] ?? 0) |
          ((payload[at + 1] ?? 0) << 8) |
          ((payload[at + 2] ?? 0) << 16) |
          ((payload[at + 3] ?? 0) << 24)) >>>
        0
      : (((payload[at] ?? 0) << 24) |
          ((payload[at + 1] ?? 0) << 16) |
          ((payload[at + 2] ?? 0) << 8) |
          (payload[at + 3] ?? 0)) >>>
        0;

  const ifdOffset = read32(tiff + 4);
  const ifd = tiff + ifdOffset;
  if (ifd + 2 > payload.length) return null;
  const count = read16(ifd);
  // Un IFD réaliste compte quelques dizaines d'entrées ; au-delà, le fichier
  // est douteux et on ne cherche plus.
  if (count > 512) return null;
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > payload.length) return null;
    if (read16(entry) === EXIF_ORIENTATION_TAG) {
      const value = read16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** Cherche un segment APP1 EXIF dans un JPEG et en lit l'orientation. */
function readJpegExifOrientation(bytes: Uint8Array): number | null {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = readUInt16BE(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker === 0xe1) {
      const payload = bytes.subarray(offset + 4, offset + 2 + length);
      const orientation = readExifOrientation(payload);
      if (orientation !== null) return orientation;
    }
    offset += 2 + length;
  }
  return null;
}

/** Idem pour le chunk EXIF d'un WebP. */
function readWebpExifOrientation(bytes: Uint8Array): number | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(
      bytes[offset]!,
      bytes[offset + 1]!,
      bytes[offset + 2]!,
      bytes[offset + 3]!,
    );
    const size = readUInt16LE(bytes, offset + 4) | (readUInt16LE(bytes, offset + 6) << 16);
    const dataEnd = offset + 8 + size;
    if (dataEnd > bytes.length) return null;
    if (fourcc === "EXIF") {
      const orientation = readExifOrientation(bytes.subarray(offset + 8, dataEnd));
      if (orientation !== null) return orientation;
    }
    offset = dataEnd + (size % 2);
  }
  return null;
}

/**
 * Construit un EXIF minimal ne contenant QUE l'orientation.
 *
 * Le bloc TIFF fait 26 octets : en-tête (« MM », 42, offset IFD), un IFD à une
 * seule entrée (le tag orientation), puis l'offset du prochain IFD à zéro.
 * Aucun GPS, aucun commentaire, aucune miniature.
 */
function buildExifPayload(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  tiff[0] = 0x4d; // "MM" : gros-boutiste
  tiff[1] = 0x4d;
  tiff[2] = 0x00;
  tiff[3] = 0x2a; // 42, constante TIFF
  tiff[4] = 0x00;
  tiff[5] = 0x00;
  tiff[6] = 0x00;
  tiff[7] = 0x08; // IFD0 commence juste après l'en-tête
  tiff[8] = 0x00;
  tiff[9] = 0x01; // une seule entrée
  tiff[10] = 0x01;
  tiff[11] = 0x12; // tag 0x0112 = Orientation
  tiff[12] = 0x00;
  tiff[13] = 0x03; // type 3 = SHORT
  tiff[14] = 0x00;
  tiff[15] = 0x00;
  tiff[16] = 0x00;
  tiff[17] = 0x01; // une valeur
  tiff[18] = (orientation >> 8) & 0xff;
  tiff[19] = orientation & 0xff;
  // Les octets 20 à 25 restent à zéro : bourrage de la valeur + offset du
  // prochain IFD (0 = pas d'autre IFD).

  const payload = new Uint8Array(EXIF_HEADER.length + tiff.length);
  payload.set(EXIF_HEADER, 0);
  payload.set(tiff, EXIF_HEADER.length);
  return payload;
}

/** Écrit un segment APP1 EXIF complet (0xFFE1 + longueur + « Exif\0\0 » + TIFF). */
function pushExifSegment(out: number[], orientation: number): void {
  const payload = buildExifPayload(orientation);
  const length = payload.length + 2; // la longueur se compte elle-même
  out.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff);
  for (let i = 0; i < payload.length; i += 1) out.push(payload[i]!);
}
