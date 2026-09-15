// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
const origLog = console.log;
const origError = console.error;
class Logger {
    logPath;
    constructor() {
        const logsDir = path.join(app.getPath('userData'), 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        const dateStr = new Date().toISOString().split('T')[0];
        this.logPath = path.join(logsDir, `sniper_${dateStr}.log`);
    }
    write(level, message, ...optionalParams) {
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now.getTime() - tzOffset)).toISOString().slice(0, 23).replace('T', ' ');
        let output = `[${localISOTime}] [${level}] `;
        if (typeof message === 'object') {
            try {
                output += JSON.stringify(message);
            }
            catch (e) {
                output += String(message);
            }
        }
        else {
            output += message;
        }
        if (optionalParams && optionalParams.length > 0) {
            output += ' ' + optionalParams.map(p => {
                if (typeof p === 'object') {
                    try {
                        return JSON.stringify(p);
                    }
                    catch (e) {
                        return String(p);
                    }
                }
                return p;
            }).join(' ');
        }
        output += '\n';
        // Print to original console
        if (level === 'ERROR') {
            origError(message, ...optionalParams);
        }
        else {
            origLog(message, ...optionalParams);
        }
        // Append to file
        try {
            fs.appendFileSync(this.logPath, output);
        }
        catch (e) {
            origError("Failed to write to log file:", e);
        }
    }
    info(message, ...optionalParams) {
        this.write('INFO', message, ...optionalParams);
    }
    error(message, ...optionalParams) {
        this.write('ERROR', message, ...optionalParams);
    }
}
const loggerInstance = new Logger();
// Override global console
console.log = (...args) => loggerInstance.info(args[0], ...args.slice(1));
console.error = (...args) => loggerInstance.error(args[0], ...args.slice(1));
export const logger = loggerInstance;
