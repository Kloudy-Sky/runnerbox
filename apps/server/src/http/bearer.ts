import type * as HttpServerRequest from "effect/http/HttpServerRequest";

export const bearerToken = (request: HttpServerRequest.HttpServerRequest) => {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "");
  return match?.[1];
};
