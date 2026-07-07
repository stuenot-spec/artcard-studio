/**
 * Image generation wrapper — calls Python subprocess with absolute path.
 */
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Works in both ESM and CJS contexts
function getScriptDir(): string {
  try {
    // ESM
    const __filename = fileURLToPath(import.meta.url);
    return path.dirname(__filename);
  } catch {
    // CJS
    return __dirname;
  }
}

interface GenerateOptions {
  imageBytes?: Buffer;
  imageMediaType?: string;
  aspectRatio?: string;
  model?: string;
}

export async function generate_image(prompt: string, options: GenerateOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Try multiple possible script locations
    const possibleDirs = [
      getScriptDir(),
      path.join(process.cwd(), "server"),
      path.join(process.cwd(), "dist"),
      "/home/user/workspace/art-visualizer/server",
    ];

    // Pick the first dir where the script exists
    const fs = require("fs");
    let scriptPath = "";
    for (const dir of possibleDirs) {
      const candidate = path.join(dir, "run_generate.py");
      if (fs.existsSync(candidate)) {
        scriptPath = candidate;
        break;
      }
    }

    if (!scriptPath) {
      return reject(new Error("run_generate.py not found in any expected location"));
    }

    const args = [
      scriptPath,
      "--prompt", prompt,
      "--aspect_ratio", options.aspectRatio || "1:1",
      "--model", options.model || "gpt_image_2",
    ];

    if (options.imageMediaType) {
      args.push("--media_type", options.imageMediaType);
    }

    const child = require("child_process").spawn("python3", args, {
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    });

    if (options.imageBytes) {
      child.stdin.write(options.imageBytes);
    }
    child.stdin.end();

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    child.on("close", (code: number) => {
      const errMsg = Buffer.concat(errChunks).toString();
      if (errMsg) console.error(`[imageGen] stderr: ${errMsg.slice(0, 300)}`);
      if (code !== 0) {
        reject(new Error(`Image generation failed (code ${code}): ${errMsg.slice(0, 200)}`));
      } else {
        const result = Buffer.concat(chunks);
        if (result.length < 100) {
          reject(new Error(`Empty image output. Stderr: ${errMsg.slice(0, 200)}`));
        } else {
          resolve(result);
        }
      }
    });

    child.on("error", (err: Error) => {
      console.error("[imageGen] spawn error:", err);
      reject(err);
    });
  });
}
