import http from "node:http";

const ROUTES = [
  { prefix: "/cerberus-api", port: 4050 },
  { prefix: "/presenter", port: 4070 },
];

const server = http.createServer((request, response) => {
  const route = ROUTES.find(
    ({ prefix }) =>
      request.url === prefix || request.url?.startsWith(`${prefix}/`),
  );
  if (!route) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
    return;
  }

  const path = request.url.slice(route.prefix.length) || "/";
  const headers = { ...request.headers, host: `127.0.0.1:${route.port}` };
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: route.port,
      path,
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json" });
    }
    response.end('{"error":"upstream_unavailable"}');
  });
  request.pipe(upstream);
});

server.listen(4080, "127.0.0.1", () => {
  console.log("CERBERUS deployment ingress listening on http://127.0.0.1:4080");
});
