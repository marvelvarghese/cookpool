// Google sign-in starts on api-edge's own host (cookpool-spliteco SE-8):
// Google returns to api-edge's callback, and the start's state cookie is set
// on the host the start ran on, so a start on Spliteco's `/api` never matched.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { LOCAL_API, oauthBaseFor } from "@/lib/oauth";

describe("where Google sign-in starts", () => {
  it("is the environment's api-edge on a deployed host", () => {
    expect(oauthBaseFor("https://cookpool-spliteco-web-stage.cookpool.workers.dev")).toBe("https://cookpool-api-edge-stage.cookpool.workers.dev");
    expect(oauthBaseFor("https://cookpool-spliteco-web-prod.cookpool.workers.dev")).toBe("https://cookpool-api-edge-prod.cookpool.workers.dev");
    expect(oauthBaseFor("https://Cookpool-Spliteco-Web-Dev.cookpool.workers.dev")).toBe("https://cookpool-api-edge-dev.cookpool.workers.dev");
  });

  it("is the local API on a local host, and this origin's /api elsewhere", () => {
    expect(oauthBaseFor("http://localhost:3000")).toBe(LOCAL_API);
    expect(oauthBaseFor("http://127.0.0.1:3000")).toBe(LOCAL_API);
    expect(oauthBaseFor("https://split.example.com")).toBe("https://split.example.com/api");
    expect(oauthBaseFor("not a url")).toBe("not a url/api");
  });

  it("is what the app's client uses", () => {
    const session = readFileSync(`${cwd()}/../../apps/spliteco-web/src/lib/session.tsx`, "utf8");
    expect(session).toContain("oauthBaseUrl:");
    expect(session).toContain("oauthBaseFor(window.location.origin)");
    const signIn = readFileSync(`${cwd()}/../../apps/spliteco-web/src/app/sign-in/page.tsx`, "utf8");
    expect(signIn).toContain("makeClient(null).auth.oauthStartUrl(\"google\"");
  });
});
