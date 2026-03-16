import * as fs from "fs";
import * as path from "path";
import { MessageLogEntry } from "./types.js";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "messages.log");

export class MessageLogger {
  private initialized = false;

  private ensureLogDir(): void {
    if (!this.initialized) {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }
      this.initialized = true;
    }
  }

  log(entry: MessageLogEntry): void {
    this.ensureLogDir();

    const logLine = `${entry.timestamp} | ${entry.direction} | ${entry.user_id} | ${entry.content} | ${entry.status}${entry.message_id ? ` | ${entry.message_id}` : ""}\n`;

    try {
      fs.appendFileSync(LOG_FILE, logLine, "utf-8");
    } catch (error) {
      console.error(`[MessageLogger] Failed to write log: ${error}`);
    }
  }

  logInbound(message_id: string, user_id: string, content: string): void {
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    this.log({
      timestamp,
      direction: "IN",
      user_id,
      content,
      status: "received",
      message_id,
    });
  }

  logOutbound(user_id: string, content: string, message_id?: string): void {
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    this.log({
      timestamp,
      direction: "OUT",
      user_id,
      content,
      status: "sent",
      message_id,
    });
  }

  logError(message_id: string, user_id: string, content: string, error: string): void {
    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
    this.log({
      timestamp,
      direction: "ERROR",
      user_id,
      content,
      status: error,
      message_id,
    });
  }
}

export const messageLogger = new MessageLogger();
