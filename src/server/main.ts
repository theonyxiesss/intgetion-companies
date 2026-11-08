import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { logger } from "@intgetion/kit";
import { setCompaniesPorts } from "../ports";
import { createApp } from "./app";
import { httpCompaniesPorts } from "./remote-ports";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", origin), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit);
}

required("DATABASE_URL");
const endpoint = (prefix: string) => ({
  url: required(`${prefix}_URL`),
  token: required(`${prefix}_SERVICE_TOKEN`),
});
setCompaniesPorts(
  httpCompaniesPorts({
    platform: { url: required("PLATFORM_URL"), token: required("PLATFORM_CALLBACK_TOKEN") },
    notifications: endpoint("NOTIFICATIONS"),
  }),
);
const handle = createApp({ serviceToken: required("COMPANIES_SERVICE_TOKEN") });
const port = Number(process.env.PORT ?? 4070);

createServer(async (req, res) => {
  const response = await handle(toRequest(req, `http://localhost:${port}`));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => {
  logger.info({ port }, "companies service listening");
});
