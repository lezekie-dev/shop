import { describe, expect, it } from "vitest";

import {
  extensionForMime,
  looksLikeSvg,
  readImageDimensions,
  readImageOrientation,
  sanitizeImage,
  sniffImageMime,
} from "@/domain/image-format";

import {
  buildJpeg,
  buildPng,
  buildWebp,
  jpegSegmentMarkers,
  pngChunkTypes,
  webpChunkFourccs,
} from "../helpers/image-fixtures";

/**
 * Reconnaissance et assainissement des images.
 *
 * Ces tests visent le code de SÉCURITÉ du téléversement. Ils tournent sans
 * base de données et sans route HTTP : un contrôle qui ne tient qu'à travers
 * une route est un contrôle qu'on ne peut pas isoler quand il casse.
 */

describe("signature binaire — ce qui décide du type réel", () => {
  it("reconnaît un vrai PNG", () => {
    expect(sniffImageMime(buildPng({ width: 64, height: 48 }))).toBe("image/png");
  });

  it("reconnaît un JPEG", () => {
    expect(sniffImageMime(buildJpeg({ width: 64, height: 48 }))).toBe("image/jpeg");
  });

  it("reconnaît un WebP", () => {
    expect(sniffImageMime(buildWebp({ width: 64, height: 48 }))).toBe("image/webp");
  });

  it("refuse un fichier texte renommé en .png (l'ATTENTAT que le contrôle bloque)", () => {
    // C'est le cas central : un client peut envoyer
    //   -F "file=@payload.php;filename=photo.png;type=image/png"
    // L'extension et le Content-Type disent « image », le contenu dit autre
    // chose. Seule la signature binaire tranche.
    const content = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect(sniffImageMime(content)).toBeNull();
  });

  it("refuse un SVG, même téléversé sous un nom trompeur", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniffImageMime(svg)).toBeNull();
    // Et le refus est EXPLIQUÉ : le marchand doit comprendre pourquoi.
    expect(looksLikeSvg(svg)).toBe(true);
  });

  it("détecte un SVG précédé d'un BOM ou d'une déclaration XML", () => {
    const withBom = new TextEncoder().encode('\uFEFF<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(looksLikeSvg(withBom)).toBe(true);
  });

  it("ne confond pas un WebP avec un RIFF d'un autre type (WAV)", () => {
    const wav = new Uint8Array(16);
    wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    wav.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(sniffImageMime(wav)).toBeNull();
  });

  it("refuse un fichier vide ou trop court", () => {
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("dimensions réelles", () => {
  it("lit largeur et hauteur d'un PNG conforme", () => {
    expect(readImageDimensions(buildPng({ width: 640, height: 480 }), "image/png")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("lit les dimensions d'un JPEG dans le SOF", () => {
    expect(readImageDimensions(buildJpeg({ width: 300, height: 200 }), "image/jpeg")).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("lit les dimensions d'un WebP étendu (VP8X)", () => {
    expect(readImageDimensions(buildWebp({ width: 1024, height: 512 }), "image/webp")).toEqual({
      width: 1024,
      height: 512,
    });
  });

  it("lit les dimensions d'un WebP sans perte (VP8L)", () => {
    // Un WebP sans chunk VP8X : les dimensions sont dans le VP8L lui-même.
    const lossless = buildWebp({ width: 700, height: 400 });
    const vp8lOnly = new Uint8Array(lossless);
    // On retire le chunk VP8X (12 premiers octets d'en-tête + 18 du chunk).
    const body = vp8lOnly.subarray(12 + 8 + 10);
    const rebuilt = new Uint8Array(12 + body.length);
    rebuilt.set(vp8lOnly.subarray(0, 12), 0);
    rebuilt.set(body, 12);
    expect(readImageDimensions(rebuilt, "image/webp")).toEqual({ width: 700, height: 400 });
  });

  it("renvoie null sur un en-tête tronqué plutôt que d'inventer une taille", () => {
    const truncated = buildPng({ width: 64, height: 64 }).subarray(0, 12);
    expect(readImageDimensions(truncated, "image/png")).toBeNull();
  });

  it("annonce les dimensions d'une bombe de décompression sans décoder l'image", () => {
    // 60 000 × 60 000 pixels : ~14 Go au décodage. Le fichier, lui, est
    // minuscule (en-tête seul) — c'est tout le principe de la bombe : la
    // taille compressée ne dit rien du nombre de pixels. Le serveur lit
    // l'en-tête pour pouvoir refuser AVANT de décoder.
    const bomb = buildPng({ width: 60_000, height: 60_000, headerOnly: true });
    expect(bomb.length).toBeLessThan(200);
    expect(readImageDimensions(bomb, "image/png")).toEqual({ width: 60_000, height: 60_000 });
  });
});

describe("assainissement — ce qui part vraiment sur le disque", () => {
  it("PNG : jette les chunks de métadonnées et garde ceux qui affichent l'image", () => {
    const withMetadata = buildPng({
      width: 64, height: 64,
      extraChunks: [
        { type: "tEXt", data: new TextEncoder().encode("Comment<script>alert(1)</script>") },
        { type: "eXIf", data: new TextEncoder().encode("MM\u0000*gps:48.85;2.35") },
        { type: "tIME", data: new Uint8Array(7) },
      ],
    });
    // Le fichier de départ contient bien la charge suspecte…
    expect(pngChunkTypes(withMetadata)).toContain("tEXt");

    const clean = sanitizeImage(withMetadata, "image/png");

    // …et l'image écrite sur le disque ne la contient plus.
    expect(pngChunkTypes(clean)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(Buffer.from(clean).includes("alert(1)")).toBe(false);
    expect(Buffer.from(clean).includes("gps:48.85")).toBe(false);
    // L'image reste lisible : même signature, mêmes dimensions.
    expect(sniffImageMime(clean)).toBe("image/png");
    expect(readImageDimensions(clean, "image/png")).toEqual({ width: 64, height: 64 });
  });

  it("PNG : conserve le chunk PLTE d'une image indexée (sinon l'image serait illisible)", () => {
    const indexed = buildPng({
      width: 64, height: 64,
      extraChunks: [{ type: "PLTE", data: new Uint8Array([255, 0, 0]) }],
    });
    const clean = sanitizeImage(indexed, "image/png");
    expect(pngChunkTypes(clean)).toContain("PLTE");
  });

  it("JPEG : jette APP1/COM mais conserve l'orientation, sans quoi la photo s'affiche couchée", () => {
    const portrait = buildJpeg({
      width: 400, height: 600,
      orientation: 6, // portrait : la rotation est DANS les métadonnées
      description: "GPS 48.8566,2.3522 — photo prise à la maison",
      comment: "Appareil: telephone de Fatou",
    });
    expect(readImageOrientation(portrait, "image/jpeg")).toBe(6);

    const clean = sanitizeImage(portrait, "image/jpeg");

    // Plus aucune métadonnée d'origine : ni le commentaire, ni la description
    // GPS, ni aucun segment APPn/COM recopié.
    expect(Buffer.from(clean).includes("GPS 48.8566")).toBe(false);
    expect(Buffer.from(clean).includes("telephone de Fatou")).toBe(false);
    expect(jpegSegmentMarkers(clean)).not.toContain("COM");
    // Un seul APP1 subsiste : celui qu'on a reconstruit, réduit à l'orientation.
    expect(jpegSegmentMarkers(clean).filter((marker) => marker === "APP1")).toHaveLength(1);
    expect(readImageOrientation(clean, "image/jpeg")).toBe(6);
    // Et l'en-tête reste exploitable : dimensions intactes.
    expect(readImageDimensions(clean, "image/jpeg")).toEqual({ width: 400, height: 600 });
  });

  it("JPEG : n'ajoute aucun EXIF quand l'image n'est pas pivotée (orientation 1)", () => {
    const straight = buildJpeg({ width: 100, height: 100, orientation: 1 });
    const clean = sanitizeImage(straight, "image/jpeg");
    expect(jpegSegmentMarkers(clean).filter((marker) => marker === "APP1")).toHaveLength(0);
    expect(readImageOrientation(clean, "image/jpeg")).toBeNull();
  });

  it("JPEG : supprime com et APPn tout en laissant un flux décodable (SOI…EOI)", () => {
    const jpeg = buildJpeg({ width: 64, height: 64, comment: "à jeter" });
    const clean = sanitizeImage(jpeg, "image/jpeg");
    expect(clean[0]).toBe(0xff);
    expect(clean[1]).toBe(0xd8);
    expect(clean[clean.length - 2]).toBe(0xff);
    expect(clean[clean.length - 1]).toBe(0xd9);
  });

  it("WebP : jette EXIF/XMP/ICCP et met à jour les drapeaux VP8X", () => {
    const webp = buildWebp({
      width: 800, height: 600,
      orientation: 8,
      description: "48.8566,2.3522",
      withXmp: true,
      withIccProfile: true,
    });
    expect(webpChunkFourccs(webp)).toContain("ICCP");
    expect(webpChunkFourccs(webp)).toContain("XMP ");

    const clean = sanitizeImage(webp, "image/webp");

    expect(webpChunkFourccs(clean)).not.toContain("ICCP");
    expect(webpChunkFourccs(clean)).not.toContain("XMP ");
    expect(Buffer.from(clean).includes("48.8566")).toBe(false);
    // Les drapeaux VP8X ne doivent plus annoncer ICCP/XMP, sinon le fichier
    // serait invalide (un profil annoncé mais absent).
    const vp8xOffset = 12;
    const flags = clean[vp8xOffset + 8]!;
    expect(flags & 0x20).toBe(0); // ICCP retiré
    expect(flags & 0x04).toBe(0); // XMP retiré
    expect(flags & 0x08).toBe(0x08); // EXIF conservé
    expect(readImageOrientation(clean, "image/webp")).toBe(8);
    expect(readImageDimensions(clean, "image/webp")).toEqual({ width: 800, height: 600 });
  });

  it("est idempotent : assainir une image déjà assainie ne la dégrade pas", () => {
    const once = sanitizeImage(buildJpeg({ width: 200, height: 100, orientation: 3 }), "image/jpeg");
    const twice = sanitizeImage(once, "image/jpeg");
    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
  });

  it("n'écrit jamais les octets reçus tels quels", () => {
    const original = buildPng({
      width: 64, height: 64,
      extraChunks: [{ type: "tEXt", data: new TextEncoder().encode("marqueur-a-jeter") }],
    });
    const clean = sanitizeImage(original, "image/png");
    expect(Buffer.from(clean).equals(Buffer.from(original))).toBe(false);
  });
});

describe("extension de fichier", () => {
  it("associe une extension sans ambiguïté à chaque type accepté", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/webp")).toBe("webp");
  });
});
