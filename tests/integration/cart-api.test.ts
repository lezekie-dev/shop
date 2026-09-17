import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  DELETE as cartDelete,
  GET as cartGet,
  PATCH as cartPatch,
  POST as cartPost,
} from "@/app/api/cart/route";
import { GET as cartCount } from "@/app/api/cart/count/route";

import { prismaTest, resetDb, seedFixtures } from "../helpers/prisma-test";
import { CART_COOKIE_NAME } from "@/server/cart";

function jsonRequest(url: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${CART_COOKIE_NAME}=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function methodRequest(method: string, url: string, body?: unknown, cookie?: string): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${CART_COOKIE_NAME}=${cookie}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prismaTest.$disconnect();
});

describe("POST /api/cart", () => {
  it("ajoute un article et pose le cookie cart_id pour un nouveau visiteur", async () => {
    await seedFixtures();
    const variant = (
      await prismaTest.product.findUniqueOrThrow({
        where: { slug: "t-shirt-basique-blanc" },
        include: { variants: true },
      })
    ).variants[0];

    const req = jsonRequest("http://localhost:3000/api/cart", {
      variantId: variant!.id,
      quantity: 2,
    });
    const res = await cartPost(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      variantId: variant!.id,
      quantity: 2,
      unitPriceCents: 1990,
    });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(new RegExp(`${CART_COOKIE_NAME}=`));
    expect(setCookie).toMatch(/HttpOnly/i);

    // DB sanity : un Cart créé avec la bonne ligne
    const dbCart = await prismaTest.cart.findUnique({
      where: { id: data.id },
      include: { items: true },
    });
    expect(dbCart?.status).toBe("ACTIVE");
    expect(dbCart?.items).toHaveLength(1);
  });

  it("agrège la quantité pour un même variant", async () => {
    await seedFixtures();
    const variant = (
      await prismaTest.product.findUniqueOrThrow({
        where: { slug: "t-shirt-basique-blanc" },
        include: { variants: true },
      })
    ).variants[0]!;
    const r1 = await cartPost(jsonRequest("http://localhost:3000/api/cart", { variantId: variant.id, quantity: 2 }));
    const data1 = await r1.json();
    const cookie = data1.id as string;

    const r2 = await cartPost(jsonRequest("http://localhost:3000/api/cart", { variantId: variant.id, quantity: 3 }, cookie));
    const data2 = await r2.json();
    expect(data2.items).toHaveLength(1);
    expect(data2.items[0].quantity).toBe(5);
  });

  it("refuse une quantité > stock disponible avec 409", async () => {
    await seedFixtures();
    // Crée un variant à 1 unité de stock pour tester le dépassement.
    const product = await prismaTest.product.findUniqueOrThrow({
      where: { slug: "t-shirt-basique-blanc" },
    });
    const rare = await prismaTest.variant.create({
      data: {
        sku: "TSHIRT-RARE-M",
        name: "Rare / M",
        priceCents: 1990,
        attributes: {},
        productId: product.id,
      },
    });
    await prismaTest.stock.create({
      data: { variantId: rare.id, quantity: 1, reserved: 0 },
    });

    const req = jsonRequest("http://localhost:3000/api/cart", { variantId: rare.id, quantity: 5 });
    const res = await cartPost(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("OUT_OF_STOCK");
  });

  it("refuse une quantité <= 0 avec 400", async () => {
    await seedFixtures();
    const variant = (
      await prismaTest.product.findUniqueOrThrow({
        where: { slug: "t-shirt-basique-blanc" },
        include: { variants: true },
      })
    ).variants[0]!;
    const res = await cartPost(jsonRequest("http://localhost:3000/api/cart", { variantId: variant.id, quantity: 0 }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/cart", () => {
  it("renvoie le panier et ses items", async () => {
    await seedFixtures();
    const variant = (
      await prismaTest.product.findUniqueOrThrow({
        where: { slug: "t-shirt-basique-blanc" },
        include: { variants: true },
      })
    ).variants[0]!;
    const postRes = await cartPost(
      jsonRequest("http://localhost:3000/api/cart", { variantId: variant.id, quantity: 2 }),
    );
    const data = await postRes.json();
    const cookie = data.id as string;

    const getRes = await cartGet(methodRequest("GET", "http://localhost:3000/api/cart", undefined, cookie));
    expect(getRes.status).toBe(200);
    const got = await getRes.json();
    expect(got.id).toBe(cookie);
    expect(got.items).toHaveLength(1);
    expect(got.totals.subtotalCents).toBe(3980);
  });

  it("crée un nouveau panier si pas de cookie", async () => {
    await seedFixtures();
    const res = await cartGet(methodRequest("GET", "http://localhost:3000/api/cart"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.items).toEqual([]);
    expect(data.count).toBe(0);
  });
});

describe("PATCH /api/cart", () => {
  it("met à jour la quantité d'une ligne", async () => {
    await seedFixtures();
    const variant = (
      await prismaTest.product.findUniqueOrThrow({
        where: { slug: "t-shirt-basique-blanc" },
        include: { variants: true },
      })
    ).variants[0]!;
    const post = await cartPost(jsonRequest("http://localhost:3000/api/cart", { variantId: variant.id, quantity: 2 }));
    const id = (await post.json()).id as string;

    const patch = await cartPatch(methodRequest("PATCH", "http://localhost:3000/api/cart", { variantId: variant.id, quantity: 5 }, id));
    expect(patch.status).toBe(200);
    const data = await patch.json();
    expect(data.items[0].quantity).toBe(5);
  });
});

describe("DELETE /api/cart", () => {
  it("supprime une ligne", async () => {
    await seedFixtures();
    const variant = (
      await prismaTest.product.findUniqueOrThrow({
        where: { slug: "t-shirt-basique-blanc" },
        include: { variants: true },
      })
    ).variants[0]!;
    const post = await cartPost(jsonRequest("http://localhost:3000/api/cart", { variantId: variant.id, quantity: 2 }));
    const id = (await post.json()).id as string;

    const del = await cartDelete(methodRequest("DELETE", "http://localhost:3000/api/cart", { variantId: variant.id }, id));
    expect(del.status).toBe(200);
    const data = await del.json();
    expect(data.items).toHaveLength(0);
  });
});

describe("GET /api/cart/count", () => {
  it("renvoie { count: 0 } sans cookie", async () => {
    await seedFixtures();
    const res = await cartCount(methodRequest("GET", "http://localhost:3000/api/cart/count"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(0);
  });

  it("renvoie le nombre d'unités du panier actif", async () => {
    await seedFixtures();
    const variant = (
      await prismaTest.product.findUniqueOrThrow({
        where: { slug: "t-shirt-basique-blanc" },
        include: { variants: true },
      })
    ).variants[0]!;
    const post = await cartPost(jsonRequest("http://localhost:3000/api/cart", { variantId: variant.id, quantity: 3 }));
    const id = (await post.json()).id as string;

    const res = await cartCount(methodRequest("GET", "http://localhost:3000/api/cart/count", undefined, id));
    const data = await res.json();
    expect(data.count).toBe(3);
  });
});
