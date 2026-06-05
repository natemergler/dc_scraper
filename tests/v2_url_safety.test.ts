import { assertEquals } from "@std/assert";
import { containsLocalPath, isPublicHttpUrl, toPublicHttpUrl } from "../src/v2/url_safety.ts";

Deno.test("url safety detects decoded local paths without rejecting ordinary public URL paths", () => {
  assertEquals(containsLocalPath("artifact at /tmp/dc-scraper/source.json"), true);
  assertEquals(containsLocalPath("artifact at %2Ftmp%2Fdc-scraper%2Fsource.json"), true);
  assertEquals(containsLocalPath("file:///tmp/dc-scraper/source.json"), true);
  assertEquals(containsLocalPath("C:\\Users\\Nate\\source.json"), true);
  assertEquals(containsLocalPath("artifact at /etc/dc-scraper/source.json"), true);
  assertEquals(containsLocalPath("artifact at /var/tmp/dc-scraper/source.json"), true);
  assertEquals(containsLocalPath("artifact at /root/dc-scraper/source.json"), true);
  assertEquals(containsLocalPath("https://example.com/tmp/source.json"), false);
});

Deno.test("url safety accepts only public http URLs", () => {
  assertEquals(isPublicHttpUrl("https://data.dc.gov/api/views/abc"), true);
  assertEquals(isPublicHttpUrl("http://localhost/source.json"), false);
  assertEquals(isPublicHttpUrl("http://intranet/source.json"), false);
  assertEquals(isPublicHttpUrl("http://host.docker.internal/source.json"), false);
  assertEquals(isPublicHttpUrl("http://10.0.0.4/source.json"), false);
  assertEquals(isPublicHttpUrl("http://[::ffff:127.0.0.1]/source.json"), false);
  assertEquals(isPublicHttpUrl("file:///tmp/source.json"), false);
  assertEquals(isPublicHttpUrl("/tmp/source.json"), false);
});

Deno.test("url safety resolves connector URLs through the same public URL guard", () => {
  assertEquals(
    toPublicHttpUrl("https://open.dc.gov/public-bodies/", "../api/body.json"),
    "https://open.dc.gov/api/body.json",
  );
  assertEquals(
    toPublicHttpUrl("https://open.dc.gov/public-bodies/", "/tmp/source.json"),
    undefined,
  );
  assertEquals(
    toPublicHttpUrl("https://open.dc.gov/public-bodies/", "http://localhost/source.json"),
    undefined,
  );
  assertEquals(
    toPublicHttpUrl("https://open.dc.gov/public-bodies/", "https://example.com/tmp/source.json"),
    "https://example.com/tmp/source.json",
  );
});
