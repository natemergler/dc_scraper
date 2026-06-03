import { dirname, isAbsolute, join, resolve } from "@std/path";

export async function readGitCommit(repoRoot: string): Promise<string> {
  const gitDir = await resolveGitDir(repoRoot);
  if (!gitDir) return "unknown";
  const head = await safeReadText(join(gitDir, "HEAD"));
  if (!head) return "unknown";
  if (!head.startsWith("ref: ")) return head.trim() || "unknown";
  const ref = head.slice(5).trim();
  const direct = await safeReadText(join(gitDir, ref));
  if (direct?.trim()) return direct.trim();
  const packedRefs = await safeReadText(join(gitDir, "packed-refs"));
  if (!packedRefs) return "unknown";
  for (const line of packedRefs.split("\n")) {
    if (line.startsWith("#") || line.startsWith("^")) continue;
    const [hash, packedRef] = line.trim().split(" ");
    if (packedRef === ref && hash) return hash;
  }
  return "unknown";
}

async function resolveGitDir(repoRoot: string): Promise<string | undefined> {
  const gitPath = join(repoRoot, ".git");
  try {
    const stat = await Deno.stat(gitPath);
    if (stat.isDirectory) return gitPath;
  } catch {
    // fall through to .git file handling
  }
  const gitFile = await safeReadText(gitPath);
  if (!gitFile?.startsWith("gitdir:")) return undefined;
  const rawGitDir = gitFile.slice("gitdir:".length).trim();
  return isAbsolute(rawGitDir) ? rawGitDir : resolve(dirname(gitPath), rawGitDir);
}

async function safeReadText(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}
