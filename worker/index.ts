interface StaticAssets {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: StaticAssets;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
