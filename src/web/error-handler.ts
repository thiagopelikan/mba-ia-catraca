import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isDbUnavailableError } from "../db/errors";
import "./auth/plugin";

export const INTERNAL_ERROR_MESSAGE = "Erro interno. Tente novamente em instantes.";
export const UNAVAILABLE_MESSAGE = "Serviço temporariamente indisponível. Tente novamente em instantes.";

/** Erros 4xx do próprio Fastify (leitura do corpo). Outros 4xx recebem a mensagem genérica. */
const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: "Requisição inválida.",
  413: "O conteúdo enviado é grande demais.",
  415: "Tipo de conteúdo não aceito.",
};
const CLIENT_ERROR_FALLBACK = "Não foi possível processar a requisição.";

interface ErrorPage {
  status: number;
  title: string;
  message: string;
}

function pageFor(error: unknown): ErrorPage {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return {
      status: statusCode,
      title: "Requisição inválida",
      message: CLIENT_ERROR_MESSAGES[statusCode] ?? CLIENT_ERROR_FALLBACK,
    };
  }
  if (isDbUnavailableError(error)) {
    return { status: 503, title: "Serviço indisponível", message: UNAVAILABLE_MESSAGE };
  }
  return { status: 500, title: "Erro interno", message: INTERNAL_ERROR_MESSAGE };
}

/** Registrar um erro nunca pode impedir a resposta. */
function log(line: string, error: unknown): void {
  try {
    console.error(line, error);
  } catch {
    // sem ter onde registrar, segue
  }
}

/**
 * Tratador de erro das páginas (instância raiz; a API de parceiros tem o dela, em JSON).
 *
 * - Erro 5xx ou sem status: registra método, URL e o erro, e responde 500 com a página de erro do produto — ou
 *   503 se o erro é de conexão com o banco.
 * - Erro 4xx do Fastify (corpo malformado, 413, 415…): mesmo status, página simples, sem log de erro.
 *
 * A página não consulta o banco (o usuário da navegação é o que o hook de sessão já carregou, se carregou) e o
 * tratador nunca lança: se a renderização falhar, responde texto puro.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const page = pageFor(error);
    if (page.status >= 500) log(`Erro em ${request.method} ${request.url} (resposta ${page.status})`, error);

    reply.code(page.status);
    try {
      const html = await app.view("error.ejs", { ...page, user: request.user ?? null });
      return reply.type("text/html; charset=utf-8").send(html);
    } catch (renderError) {
      log("Falha ao renderizar a página de erro", renderError);
      return reply.type("text/plain; charset=utf-8").send(page.message);
    }
  });
}
