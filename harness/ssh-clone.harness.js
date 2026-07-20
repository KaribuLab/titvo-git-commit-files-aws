"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
#;
SshCloneHarness;
smoke;
test;
del;
clone;
SSH(Nivel, 2);
#;
#;
Valida;
la;
hipótesis;
central;
ANTES;
de;
cablear;
nada;
en;
NestJS: #;
"git + openssh autentican y clonan por rama y por commit SHA de verdad";
#;
#;
Uso: #;
docker;
build - t;
ssh - harness - f;
Dockerfile.harness.
;
#;
docker;
run--;
rm;
# - e;
REPO_URL = "git@bitbucket.org:WORKSPACE/REPO.git";
# - e;
CLONE_REF = "main";
# - e;
COMMIT_SHA = "";
# - v / ruta / a / tu / deploy_key;
/tmp/ssh_key;
ro;
#;
ssh - harness;
#;
#;
Si;
COMMIT_SHA;
viene;
vacío, clona;
por;
rama(CLONE_REF).
;
#;
Si;
COMMIT_SHA;
viene, hace `git checkout <COMMIT_SHA>`;
dentro;
del;
clon.
    import;
{
    execFileSync;
}
from;
"node:child_process";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const repoUrl = process.env.REPO_URL || "";
const cloneRef = process.env.CLONE_REF || "main";
const commitSha = process.env.COMMIT_SHA || "";
const keyPath = process.env.SSH_KEY_PATH || "/tmp/ssh_key";
function fail(msg) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
}
if (!repoUrl)
    fail("REPO_URL es obligatorio");
if (!fs.existsSync(keyPath))
    fail(`No existe la llave en ${keyPath}`);
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-clone-"));
const cloneDir = path.join(workdir, "repo");
const sshCmd = [
    "ssh",
    "-i", keyPath,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "IdentitiesOnly=yes",
].join(" ");
try {
    console.log(`[INFO] clonando ${repoUrl} @ ${commitSha || cloneRef} en ${cloneDir}`);
    execFileSync("git", ["clone", "--depth", "1", cloneRef ? cloneRef : "HEAD", cloneDir, repoUrl], { env: { ...process.env, GIT_SSH_COMMAND: sshCmd }, stdio: "inherit" });
    if (commitSha) {
        console.log(`[INFO] haciendo checkout del SHA ${commitSha}`);
        execFileSync("git", ["fetch", "--depth", "1", "origin", commitSha], {
            cwd: cloneDir,
            env: { ...process.env, GIT_SSH_COMMAND: sshCmd },
            stdio: "inherit",
        });
        execFileSync("git", ["checkout", commitSha], { cwd: cloneDir, stdio: "inherit" });
    }
    const resolvedSha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: cloneDir,
        encoding: "utf8",
    }).trim();
    console.log(`[INFO] HEAD resuelto: ${resolvedSha}`);
    const files = execFileSync("git", ["ls-files"], {
        cwd: cloneDir,
        encoding: "utf8",
    })
        .split("\n")
        .filter(Boolean);
    console.log(`[INFO] archivos en el tree: ${files.length}`);
    if (files.length === 0)
        fail("El clone no devolvió archivos");
    const sample = files[0];
    const content = fs.readFileSync(path.join(cloneDir, sample));
    console.log(`[INFO] leyendo muestra ${sample} (${content.length} bytes) OK`);
    console.log("[PASS] clone SSH funciona en este runtime");
    process.exit(0);
}
catch (err) {
    fail(err.message);
}
