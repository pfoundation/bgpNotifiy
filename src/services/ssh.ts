import { Client } from "ssh2";
import fs from "node:fs";
import to from "await-to-js";
import type { Config } from "../config.js";

const SSH_CONNECT_TIMEOUT_MS = 15_000;
const SSH_COMMAND_TIMEOUT_MS = 30_000;

export class SshService {
  private config: Config;
  private privateKey: Buffer | null = null;

  constructor(config: Config) {
    this.config = config;
  }

  /** Execute a command on a remote host via SSH */
  async exec(host: string, command: string): Promise<string> {
    const key = this.getPrivateKey();
    const conn = new Client();

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH command timed out after ${SSH_COMMAND_TIMEOUT_MS}ms`));
      }, SSH_COMMAND_TIMEOUT_MS);

      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              conn.end();
              reject(new Error(`SSH exec error: ${err.message}`));
              return;
            }

            let stdout = "";
            let stderr = "";

            stream
              .on("close", (code: number) => {
                clearTimeout(timeout);
                conn.end();

                if (code !== 0 && stderr) {
                  reject(
                    new Error(
                      `Command exited with code ${code}: ${stderr.trim()}`
                    )
                  );
                } else {
                  resolve(stdout);
                }
              })
              .on("data", (data: Buffer) => {
                stdout += data.toString();
              })
              .stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
              });
          });
        })
        .on("error", (err) => {
          clearTimeout(timeout);
          reject(new Error(`SSH connection error to ${host}: ${err.message}`));
        })
        .connect({
          host,
          port: this.config.sshPort,
          username: this.config.sshUser,
          privateKey: key,
          readyTimeout: SSH_CONNECT_TIMEOUT_MS,
          // Disable strict host key checking for automated use
          algorithms: {
            serverHostKey: [
              "ssh-ed25519",
              "ecdsa-sha2-nistp256",
              "ecdsa-sha2-nistp384",
              "ecdsa-sha2-nistp521",
              "rsa-sha2-512",
              "rsa-sha2-256",
              "ssh-rsa",
            ],
          },
        });
    });
  }

  /** Test connectivity to a host */
  async testConnection(host: string): Promise<boolean> {
    const [err] = await to(this.exec(host, "echo ok"));
    return !err;
  }

  private getPrivateKey(): Buffer {
    if (!this.privateKey) {
      try {
        this.privateKey = fs.readFileSync(this.config.sshKeyPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read SSH key at ${this.config.sshKeyPath}: ${msg}`);
      }
    }
    return this.privateKey;
  }
}
