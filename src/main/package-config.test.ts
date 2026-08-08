import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Linux package security", () => {
  it("uses mahiko consistently for the packaged product, executable and desktop entry", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      desktopName?: string;
      build?: { productName?: string; linux?: { executableName?: string } };
    };

    expect(packageJson.desktopName).toBe("mahiko.desktop");
    expect(packageJson.build?.productName).toBe("mahiko");
    expect(packageJson.build?.linux?.executableName).toBe("mahiko");
  });

  it("does not disable the Chromium sandbox in the AppImage launcher", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      build?: { appImage?: { executableArgs?: string[] } };
    };

    expect(packageJson.build?.appImage?.executableArgs).toEqual([]);
  });
});
