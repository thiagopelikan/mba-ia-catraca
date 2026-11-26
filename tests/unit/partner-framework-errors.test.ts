import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { partnerApiFrameworkErrors, partnerApiRewriteUrl } from "../../src/partner-api/framework-errors";

/** Regressão R8 e R9: caminho que o roteador recusaria, sob /api/partner, também na forma absoluta. */

const BAD = "%E0%A4%A";
const rewrite = (url: string): string => partnerApiRewriteUrl({ url });

describe("partnerApiRewriteUrl", () => {
  it("troca por um ID inexistente o segmento com % malformado ou com mais de 100 caracteres", () => {
    expect(rewrite(`/api/partner/tickets/${BAD}`)).toBe("/api/partner/tickets/-");
    expect(rewrite("/api/partner/tickets/tkt_%")).toBe("/api/partner/tickets/-");
    expect(rewrite("/api/partner/tickets/%zz")).toBe("/api/partner/tickets/-");
    expect(rewrite(`/api/partner/events/${BAD}/purchases`)).toBe("/api/partner/events/-/purchases");
    expect(rewrite(`/api/partner/events/${"a".repeat(101)}/purchases`)).toBe("/api/partner/events/-/purchases");
    expect(rewrite(`/api/partner/events/${"a".repeat(5000)}/purchases`)).toBe("/api/partner/events/-/purchases");
    expect(rewrite(`/api/partner/outra/${BAD}/${"b".repeat(200)}`)).toBe("/api/partner/outra/-/-");
  });

  it("a query não é examinada nem alterada", () => {
    expect(rewrite(`/api/partner/tickets/${BAD}?x=${BAD}`)).toBe(`/api/partner/tickets/-?x=${BAD}`);
    expect(rewrite(`/api/partner/events?x=${BAD}&y=${"c".repeat(300)}`)).toBe(
      `/api/partner/events?x=${BAD}&y=${"c".repeat(300)}`,
    );
  });

  it("vale para a forma absoluta do request-target e para o prefixo codificado", () => {
    expect(rewrite(`http://localhost:3210/api/partner/tickets/${BAD}`)).toBe("http://localhost:3210/api/partner/tickets/-");
    expect(rewrite(`HTTPS://outro.example/api/%70artner/events/${BAD}/purchases?q=1`)).toBe(
      "HTTPS://outro.example/api/%70artner/events/-/purchases?q=1",
    );
  });

  it("caminho bem formado da API não muda", () => {
    for (const url of [
      "/api/partner/events",
      "/api/partner/events/evt_abcdefghijkl/purchases",
      "/api/partner/tickets/tkt_abcdefghijkl?x=1",
      "/api/partner/tickets/tkt_%00x",
      "/api/partner/tickets/com%20espa%C3%A7o",
      `/api/partner/tickets/${"a".repeat(100)}`,
      "http://localhost:3210/api/partner/events",
    ]) {
      expect(rewrite(url), url).toBe(url);
    }
  });

  it("fora de /api/partner a URL não muda, por pior que seja", () => {
    for (const url of [
      "/",
      `/eventos/${BAD}`,
      `/eventos/${"a".repeat(5000)}`,
      `/api/partnerx/${BAD}`,
      `/api/${BAD}`,
      `/api%2Fpartner/tickets/${BAD}`,
      `//api/partner/tickets/${BAD}`,
      `http://localhost:3210/eventos/${BAD}?u=/api/partner/x`,
      `http://api/partner/${BAD}`,
      "*",
    ]) {
      expect(rewrite(url), url).toBe(url);
    }
    expect(partnerApiRewriteUrl({})).toBe("/");
  });
});

describe("partnerApiFrameworkErrors (rede de segurança)", () => {
  const KEY = "chave-de-teste";
  const handler = partnerApiFrameworkErrors({ partnerApiKey: KEY });
  const badUrl = { statusCode: 400, code: "FST_ERR_BAD_URL", message: "url ruim" } as FastifyError;

  function respond(method: string, url: string, headers: Record<string, string>): { status: number; body: unknown } {
    const sent = { status: 0, body: undefined as unknown };
    const reply = {
      code(status: number) {
        sent.status = status;
        return reply;
      },
      send(body: unknown) {
        sent.body = body;
        return reply;
      },
    };
    handler(badUrl, { method, headers, raw: { url } } as unknown as FastifyRequest, reply as unknown as FastifyReply);
    return sent;
  }

  const targets: Array<[string, string]> = [
    ["forma comum", ""],
    ["forma absoluta", "http://localhost:3210"],
    ["forma absoluta com outro host", "HTTP://outro.example"],
  ];
  for (const [label, origin] of targets) {
    it(`${label}: sem chave ou com chave errada → 401; com chave → 404 com o erro da rota`, () => {
      const ticket = `${origin}/api/partner/tickets/${BAD}`;
      expect(respond("GET", ticket, {})).toEqual({ status: 401, body: { error: "unauthorized" } });
      expect(respond("GET", ticket, { "x-api-key": "errada" })).toEqual({ status: 401, body: { error: "unauthorized" } });
      expect(respond("GET", ticket, { "x-api-key": KEY })).toEqual({ status: 404, body: { error: "ticket_not_found" } });
      expect(respond("POST", `${origin}/api/partner/events/${BAD}/purchases?x=1`, { "x-api-key": KEY })).toEqual({
        status: 404,
        body: { error: "event_not_available" },
      });
      expect(respond("GET", `${origin}/api/partner/outra/${BAD}`, { "x-api-key": KEY })).toEqual({
        status: 404,
        body: { error: "not_found" },
      });
    });
  }
});
