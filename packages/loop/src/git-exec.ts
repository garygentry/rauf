import { execFile } from "node:child_process";

/**
 * Runs `git <args>` in the given working directory.
 *
 * On success, resolves with stdout. On error, rejects with an Error whose
 * message is `stderr || stdout || error.message` and which carries `stdout`
 * and `stderr` string properties (callers like `isNothingToCommit` depend on
 * those properties being present).
 */
export function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr.trim() || stdout.trim() || error.message;
        const gitError = new Error(msg);
        (gitError as Error & { stdout: string; stderr: string }).stdout = stdout;
        (gitError as Error & { stdout: string; stderr: string }).stderr = stderr;
        reject(gitError);
      } else {
        resolve(stdout);
      }
    });
  });
}
