/**
 * Fabriques d'images pour les tests.
 *
 * POURQUOI CE FICHIER EXISTE
 * Tester la validation d'un téléversement avec des octets bidons ne prouve
 * rien : n'importe quel contrôle « regarde si ça commence par \x89PNG » passe.
 * On fabrique donc ici de VRAIS fichiers, octet par octet, pour pouvoir
 * vérifier ce qui compte : que le serveur reconnaît une image authentique, et
 * qu'il refuse un fichier qui ne l'est pas.
 *
 * CE QUI EST RÉELLEMENT VALIDE, ET CE QUI NE L'EST PAS
 *  - `buildPng` produit un PNG **conforme et décodable** : signature, IHDR,
 *    IDAT (scanlines filtrées puis compressées par `zlib.deflateSync`), IEND,
 *    CRC32 corrects. Un vrai décodeur l'affiche.
 *  - `buildJpeg` et `buildWebp` produisent des conteneurs **structurellement
 *    valides jusqu'au flux de données**, mais dont la charge image n'est pas
 *    encodée (aucun encodeur JPEG/WebP n'existe dans Node sans dépendance, et
 *    en ajouter une demande une ADR — cf. CONVENTIONS §9). C'est suffisant et
 *    c'est même exactement ce que le serveur lit : la validation s'appuie sur
 *    les segments d'en-tête, jamais sur le décodage des pixels. Ces deux
 *    fabriques sont donc signalées « synthétique » là où elles sont utilisées.
 */

import { deflateSync } from "node:zlib";

// ─────────────────────────────────────────────────────────────────────
// CRC32 (celui des chunks PNG)
// ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Construit un chunk PNG complet (longueur, type, données, CRC). */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const crcInput = concat([typeBytes, data]);
  return concat([u32be(data.length), typeBytes, data, u32be(crc32(crcInput))]);
}

export interface BuildPngOptions {
  width: number;
  height: number;
  /**
   * Chunks annexes à insérer avant IEND. Sert à prouver que les métadonnées
   * (`tEXt`, `eXIf`…) ne sont PAS recopiées telles quelles à l'écriture.
   */
  extraChunks?: ReadonlyArray<{ type: string; data: Uint8Array }>;
  /**
   * N'émet que la signature, l'IHDR et l'IEND : pas de données image. C'est la
   * forme d'une « bombe de décompression » — un fichier minuscule qui annonce
   * des dimensions énormes. Le serveur doit refuser sur l'EN-TÊTE, sans jamais
   * tenter de décoder quoi que ce soit.
   */
  headerOnly?: boolean;
}

/** PNG conforme et décodable (truecolor 8 bits, filtre 0 sur chaque ligne). */
export function buildPng(options: BuildPngOptions): Uint8Array {
  const parts: Uint8Array[] = [PNG_SIGNATURE];

  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(options.width), 0);
  ihdr.set(u32be(options.height), 4);
  ihdr[8] = 8; // profondeur 8 bits par canal
  ihdr[9] = 2; // type couleur 2 = RVB
  ihdr[10] = 0; // compression deflate
  ihdr[11] = 0; // filtre standard
  ihdr[12] = 0; // pas d'entrelacement
  parts.push(pngChunk("IHDR", ihdr));

  for (const extra of options.extraChunks ?? []) {
    parts.push(pngChunk(extra.type, extra.data));
  }

  if (!options.headerOnly) {
    const stride = options.width * 3;
    const raw = new Uint8Array((stride + 1) * options.height);
    for (let y = 0; y < options.height; y += 1) {
      const rowStart = y * (stride + 1);
      raw[rowStart] = 0; // filtre 0 = aucun
      for (let x = 0; x < options.width; x += 1) {
        const pixel = rowStart + 1 + x * 3;
        // Dégradé déterministe : deux exécutions produisent les mêmes octets,
        // donc les assertions de taille restent stables.
        raw[pixel] = (x * 4) % 256;
        raw[pixel + 1] = (y * 4) % 256;
        raw[pixel + 2] = 128;
      }
    }
    parts.push(pngChunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))));
  }

  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

/** Types de chunks présents dans un PNG, dans l'ordre. */
export function pngChunkTypes(bytes: Uint8Array): string[] {
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>>
      0;
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    types.push(type);
    offset += 12 + length;
  }
  return types;
}

// ─────────────────────────────────────────────────────────────────────
// JPEG (conteneur synthétique, en-tête exploitable)
// ─────────────────────────────────────────────────────────────────────

function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  return concat([new Uint8Array([0xff, marker]), u16be(payload.length + 2), payload]);
}

/**
 * EXIF minimal contenant l'orientation, plus éventuellement un texte libre
 * (tag ImageDescription, 0x010E) — c'est le genre de champ où se retrouvent un
 * commentaire d'appareil, un nom de fichier d'origine, voire une adresse.
 */
export function buildExifPayload(options: { orientation: number; description?: string }): Uint8Array {
  const description = options.description ?? "";
  const descriptionBytes = concat([ascii(description), new Uint8Array([0])]);
  const entryCount = description === "" ? 1 : 2;
  const ifdBytes = 2 + entryCount * 12 + 4;
  const dataOffset = 8 + ifdBytes;

  const tiff = new Uint8Array(dataOffset + (description === "" ? 0 : descriptionBytes.length));
  tiff[0] = 0x49; // "II" : petit-boutiste (l'autre écriture est testée par
  tiff[1] = 0x49; // l'EXIF que le serveur RÉÉCRIT, en gros-boutiste)
  tiff[2] = 0x2a;
  tiff[3] = 0x00;
  tiff[4] = 0x08;
  tiff[5] = 0x00;
  tiff[6] = 0x00;
  tiff[7] = 0x00;
  tiff[8] = entryCount & 0xff;
  tiff[9] = 0x00;

  // Entrée 1 : Orientation (0x0112), type SHORT (3).
  const entry1 = 10;
  tiff[entry1] = 0x12;
  tiff[entry1 + 1] = 0x01;
  tiff[entry1 + 2] = 0x03;
  tiff[entry1 + 3] = 0x00;
  tiff[entry1 + 4] = 0x01;
  tiff[entry1 + 5] = 0x00;
  // Valeur d'un SHORT : dans les DEUX PREMIERS octets du champ valeur de 4
  // octets (les deux derniers restent à zéro), en petit-boutiste ici.
  tiff[entry1 + 8] = options.orientation & 0xff;
  tiff[entry1 + 9] = 0x00;

  if (description !== "") {
    // Entrée 2 : ImageDescription (0x010E), type ASCII (2), offset dans le TIFF.
    const entry2 = entry1 + 12;
    tiff[entry2] = 0x0e;
    tiff[entry2 + 1] = 0x01;
    tiff[entry2 + 2] = 0x02;
    tiff[entry2 + 3] = 0x00;
    const count = descriptionBytes.length;
    tiff[entry2 + 4] = count & 0xff;
    tiff[entry2 + 5] = (count >> 8) & 0xff;
    tiff[entry2 + 8] = dataOffset & 0xff;
    tiff[entry2 + 9] = (dataOffset >> 8) & 0xff;
    tiff.set(descriptionBytes, dataOffset);
  }

  return concat([ascii("Exif"), new Uint8Array([0, 0]), tiff]);
}

export interface BuildJpegOptions {
  width: number;
  height: number;
  /** Orientation EXIF à déclarer (1 = normale, 6 = portrait pivoté). */
  orientation?: number;
  /** Texte placé dans le tag ImageDescription de l'EXIF. */
  description?: string;
  /** Commentaire JPEG (segment COM) : une métadonnée de plus à jeter. */
  comment?: string;
}

/**
 * JPEG synthétique : SOI, APP1 EXIF, COM, DQT, SOF0, DHT, SOS + amorce de flux,
 * EOI. Tout ce dont dépend la validation (segments d'en-tête, dimensions) est
 * conforme ; la charge image n'est pas encodée.
 */
export function buildJpeg(options: BuildJpegOptions): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];

  const exif = buildExifPayload({
    orientation: options.orientation ?? 1,
    ...(options.description === undefined ? {} : { description: options.description }),
  });
  parts.push(jpegSegment(0xe1, exif));

  if (options.comment !== undefined) {
    parts.push(jpegSegment(0xfe, ascii(options.comment)));
  }

  // DQT : une table de quantification 8 bits, longueur 67.
  const dqt = new Uint8Array(65);
  parts.push(jpegSegment(0xdb, dqt));

  // SOF0 : précision (1) + hauteur (2) + largeur (2) + 3 composantes.
  const sof = new Uint8Array(15);
  sof[0] = 8;
  sof[1] = (options.height >> 8) & 0xff;
  sof[2] = options.height & 0xff;
  sof[3] = (options.width >> 8) & 0xff;
  sof[4] = options.width & 0xff;
  sof[5] = 3;
  sof[6] = 1;
  sof[7] = 0x11;
  sof[8] = 0;
  sof[9] = 2;
  sof[10] = 0x11;
  sof[11] = 1;
  sof[12] = 3;
  sof[13] = 0x11;
  sof[14] = 1;
  parts.push(jpegSegment(0xc0, sof));

  // DHT : une table minimale (l'en-tête suffit, on ne décode pas le flux).
  const dht = new Uint8Array(29);
  dht[0] = 0x00;
  dht[1] = 1;
  dht[17] = 0;
  parts.push(jpegSegment(0xc4, dht));

  // SOS : 3 composantes, puis une amorce de flux entropique et l'EOI.
  const sos = new Uint8Array(10);
  sos[0] = 3;
  sos[1] = 1;
  sos[2] = 0x00;
  sos[3] = 2;
  sos[4] = 0x11;
  sos[5] = 3;
  sos[6] = 0x11;
  sos[7] = 0;
  sos[8] = 63;
  sos[9] = 0;
  parts.push(jpegSegment(0xda, sos));
  parts.push(new Uint8Array([0x11, 0x22, 0x33, 0xff, 0xd9]));

  return concat(parts);
}

/** Marqueurs de segments JPEG présents, dans l'ordre (« APP1 », « COM »…). */
export function jpegSegmentMarkers(bytes: Uint8Array): string[] {
  const names: string[] = [];
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    if (marker === 0xda) {
      names.push("SOS");
      break;
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker >= 0xe0 && marker <= 0xef) names.push(`APP${marker - 0xe0}`);
    else if (marker === 0xfe) names.push("COM");
    else names.push(`0x${marker.toString(16)}`);
    offset += 2 + length;
  }
  return names;
}

// ─────────────────────────────────────────────────────────────────────
// WebP (conteneur synthétique, en-tête exploitable)
// ─────────────────────────────────────────────────────────────────────

function u24le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
}

function u32le(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]);
}

function riffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(0);
  return concat([ascii(fourcc), u32le(payload.length), payload, padding]);
}

export interface BuildWebpOptions {
  width: number;
  height: number;
  /** Orientation EXIF (ajoute un chunk EXIF et le drapeau correspondant). */
  orientation?: number;
  /** Texte dans le chunk EXIF, pour prouver qu'il est jeté. */
  description?: string;
  /** Ajoute un chunk XMP, qui doit disparaître lui aussi. */
  withXmp?: boolean;
  /** Ajoute un chunk ICCP (profil couleur), qui doit disparaître. */
  withIccProfile?: boolean;
}

/**
 * WebP synthétique « étendu » (VP8X + VP8L + métadonnées optionnelles).
 * Les dimensions sont lues dans l'en-tête VP8X, comme le ferait le serveur.
 */
export function buildWebp(options: BuildWebpOptions): Uint8Array {
  const hasExif = options.orientation !== undefined;
  // Drapeaux VP8X, du bit le plus fort au plus faible : R R I L E X A R
  //   I(CCP) = 0x20, L(alpha) = 0x10, E(XIF) = 0x08, X(MP) = 0x04, A(nimation) = 0x02
  let flags = 0x10; // alpha, comme un vrai WebP avec canal alpha
  if (hasExif) flags |= 0x08;
  if (options.withXmp) flags |= 0x04;
  if (options.withIccProfile) flags |= 0x20;

  const vp8xPayload = concat([
    new Uint8Array([flags, 0, 0, 0]),
    u24le(options.width - 1),
    u24le(options.height - 1),
  ]);

  // VP8L : 0x2F puis 14 bits de largeur-1 et 14 bits de hauteur-1.
  const widthBits = options.width - 1;
  const heightBits = options.height - 1;
  const bits = (widthBits | (heightBits << 14)) >>> 0;
  const vp8lPayload = concat([new Uint8Array([0x2f]), u32le(bits), new Uint8Array([0x00, 0x00, 0x00, 0x00])]);

  const chunks: Uint8Array[] = [riffChunk("VP8X", vp8xPayload), riffChunk("VP8L", vp8lPayload)];

  if (hasExif) {
    chunks.push(
      riffChunk(
        "EXIF",
        buildExifPayload({
          orientation: options.orientation ?? 1,
          ...(options.description === undefined ? {} : { description: options.description }),
        }),
      ),
    );
  }
  if (options.withXmp) chunks.push(riffChunk("XMP ", ascii("<x:xmpmeta>donnees xmp</x:xmpmeta>")));
  if (options.withIccProfile) chunks.push(riffChunk("ICCP", new Uint8Array([1, 2, 3, 4])));

  const body = concat(chunks);
  const header = concat([ascii("RIFF"), u32le(4 + body.length), ascii("WEBP")]);
  return concat([header, body]);
}

/** Fourcc des chunks WebP présents, dans l'ordre. */
export function webpChunkFourccs(bytes: Uint8Array): string[] {
  const names: string[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = bytes[offset + 4]! | (bytes[offset + 5]! << 8) | (bytes[offset + 6]! << 16) | (bytes[offset + 7]! << 24);
    names.push(fourcc);
    offset += 8 + size + (size % 2);
  }
  return names;
}
