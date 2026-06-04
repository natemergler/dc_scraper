import { dirname, isAbsolute, join, resolve } from "@std/path";

export async function readGitCommit(repoRoot: string): Promise<string> {
  const gitDir = await resolveGitDir(repoRoot);
  if (!gitDir) return "unknown";
  const head = await safeReadText(join(gitDir, "HEAD"));
  if (!head) return "unknown";
  if (!head.startsWith("ref: ")) return head.trim() || "unknown";
  const ref = head.slice(5).trim();
  const direct = await readGitRef(gitDir, ref);
  if (direct?.trim()) return direct.trim();
  const packedRefs = await readPackedRefs(gitDir);
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

async function readGitRef(gitDir: string, ref: string): Promise<string | undefined> {
  return await safeReadText(join(gitDir, ref)) ??
    await safeReadText(join(await resolveCommonGitDir(gitDir), ref));
}

async function readPackedRefs(gitDir: string): Promise<string | undefined> {
  return await safeReadText(join(gitDir, "packed-refs")) ??
    await safeReadText(join(await resolveCommonGitDir(gitDir), "packed-refs"));
}

async function resolveCommonGitDir(gitDir: string): Promise<string> {
  const commonDir = await safeReadText(join(gitDir, "commondir"));
  if (!commonDir?.trim()) return gitDir;
  const rawCommonDir = commonDir.trim();
  return isAbsolute(rawCommonDir) ? rawCommonDir : resolve(gitDir, rawCommonDir);
}

async function safeReadText(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}
