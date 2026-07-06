const crypto = require('crypto');
const { redact } = require('./helpers');

class TempMail {
    static SUPABASE_URL = "https://ijrccpgiulrmfpavazsl.supabase.co";
    static ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqcmNjcGdpdWxybWZwYXZhenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDMwNTUsImV4cCI6MjA4ODIxOTA1NX0.ljpHFR3iy8hIqU2ddOCwKmP77xbN8-lk8MpCpuPO6tc";

    constructor(ownerToken = null) {
        if (!ownerToken) {
            this.ownerToken = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
        } else {
            this.ownerToken = ownerToken;
        }
    }

    async _request(endpoint, method = "GET", data = null, isEdgeFunction = false) {
        const url = isEdgeFunction 
            ? `${TempMail.SUPABASE_URL}/functions/v1/${endpoint}`
            : `${TempMail.SUPABASE_URL}/rest/v1/${endpoint}`;

        const headers = {
            "apikey": TempMail.ANON_KEY,
            "Authorization": `Bearer ${TempMail.ANON_KEY}`,
            "Content-Type": "application/json"
        };

        const config = {
            method,
            headers
        };

        if (data !== null) {
            config.body = JSON.stringify(data);
        }

        const res = await fetch(url, config);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP Error ${res.status}: ${text}`);
        }
        
        const text = await res.text();
        return text ? JSON.parse(text) : {};
    }

    async getDomains(includeVip = false) {
        const endpoint = "temp_domains?select=domain,label,vip_only&is_active=eq.true&order=sort_order.asc";
        let domains = await this._request(endpoint);
        if (!includeVip) {
            domains = domains.filter(d => !d.vip_only);
        }
        return domains;
    }

    async createInbox(desiredLocal = null, domain = null) {
        if (!domain) {
            const activeDomains = await this.getDomains(false);
            const targetDomains = ['openfile.my.id', 'neorastorepl.my.id', 'moymoy.me'];
            const filteredDomains = activeDomains.filter(d => targetDomains.includes(d.domain));
            
            if (filteredDomains.length === 0) {
                if (activeDomains.length === 0) {
                    throw new Error("No active domains found");
                }
                domain = activeDomains[0].domain;
            } else {
                domain = filteredDomains[Math.floor(Math.random() * filteredDomains.length)].domain;
            }
        }

        if (!desiredLocal) {
            desiredLocal = `user_${crypto.randomBytes(4).toString('hex')}`;
        }

        const payload = {
            owner_token: this.ownerToken,
            desired_local: desiredLocal,
            domain: domain
        };

        return await this._request("generate-inbox", "POST", payload, true);
    }

    async getMessages(address) {
        const encodedAddress = encodeURIComponent(address);
        const endpoint = `temp_messages?select=*&inbox_address=eq.${encodedAddress}&order=received_at.desc`;
        return await this._request(endpoint);
    }

    static cleanHtml(rawHtml) {
        if (!rawHtml) return "";
        return rawHtml
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/\s(?:href|src|action|data-[\w-]+)\s*=\s*"[^"]*"/gi, " ")
            .replace(/\s(?:href|src|action|data-[\w-]+)\s*=\s*'[^']*'/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/https?:\/\/\S+/gi, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&#(\d+);/g, (e, n) => String.fromCharCode(parseInt(n, 10)))
            .replace(/&zwnj;|&zwj;/gi, "");
    }

    static normalizeDigits(text) {
        let e = text.replace(/(?:\d[\s\-\u00A0]+){3,7}\d/g, n => {
            const t = n.replace(/[\s\-\u00A0]+/g, "");
            return t.length >= 4 && t.length <= 8 ? t : n;
        });
        return e.replace(/\b\d{2,4}(?:[\s\-\u00A0]+\d{2,4}){1,3}\b/g, n => {
            const t = n.replace(/[\s\-\u00A0]+/g, "");
            return t.length >= 4 && t.length <= 8 ? t : n;
        });
    }

    static isYear(code) {
        if (code.length !== 4) return false;
        const val = parseInt(code, 10);
        return val >= 1900 && val <= 2099;
    }

    static filterCodes(codes) {
        const valid = codes.filter(c => !TempMail.isYear(c));
        if (valid.length === 0) return null;
        return valid.find(c => c.length === 6) ?? valid[0];
    }

    static extractOtp(subject, textBody, htmlBody) {
        const p = "(?:otp|kode|code|verif(?:y|ication|ikasi)?|pin|password|passcode|security|launch\\s+code|one[-\\s]?time(?:\\s+code|\\s+password)?|2fa)";
        const parts = [subject, textBody, htmlBody].filter(Boolean);
        const combined = parts.join("\n");
        if (!combined) return null;

        const cleaned = TempMail.normalizeDigits(TempMail.cleanHtml(combined));
        
        // Pattern 1: Keyword followed by digits
        const pattern1 = new RegExp(`${p}[^\\d\\n]{0,40}(\\d{4,8})\\b`, "gi");
        const matches1 = [];
        for (const s of cleaned.matchAll(pattern1)) {
            matches1.push(s[1]);
        }
        let otp = TempMail.filterCodes(matches1);
        if (otp) return otp;

        // Pattern 2: Digits followed by keyword
        const pattern2 = new RegExp(`\\b(\\d{4,8})\\b[^\\d\\n]{0,40}${p}`, "gi");
        const matches2 = [];
        for (const s of cleaned.matchAll(pattern2)) {
            matches2.push(s[1]);
        }
        otp = TempMail.filterCodes(matches2);
        if (otp) return otp;

        // Pattern 3: Fallback to any 4-8 digits
        const matches3 = cleaned.match(/\b\d{4,8}\b/g) ?? [];
        return TempMail.filterCodes(matches3);
    }

    async waitForEmail(address, timeoutMs = 120000, pollIntervalMs = 5000) {
        const startTime = Date.now();
        console.log(`Waiting for emails on ${address} (Timeout: ${timeoutMs / 1000}s)...`);
        
        while (Date.now() - startTime < timeoutMs) {
            try {
                const messages = await this.getMessages(address);
                if (messages && messages.length > 0) {
                    return messages[0];
                }
            } catch (e) {
                console.error("Polling error:", e.message);
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        }
        return null;
    }

    async waitForOtp(address, timeoutMs = 120000, pollIntervalMs = 5000) {
        const msg = await this.waitForEmail(address, timeoutMs, pollIntervalMs);
        if (msg) {
            console.log(`Received email from: ${msg.from_address} - Subject: ${msg.subject}`);
            return TempMail.extractOtp(msg.subject, msg.text_body, msg.html_body);
        }
        return null;
    }
}

module.exports = TempMail;

// CLI runner
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);
        const client = new TempMail();

        if (args[0] === "domains") {
            console.log("Fetching active domains...");
            try {
                const domains = await client.getDomains();
                domains.forEach(d => console.log(`- ${d.domain} (${d.label})`));
            } catch (e) {
                console.error("Error:", e.message);
            }
        } else if (args[0] === "listen") {
            const addr = args[1];
            if (!addr) {
                console.log("Usage: node tempmail.js listen <email_address>");
                process.exit(1);
            }
            console.log(`Listening to ${addr}...`);
            const otp = await client.waitForOtp(addr, 300000);
            if (otp) {
                console.log(`SUCCESS! Detected OTP Code: ${otp}`);
            } else {
                console.log("TIMEOUT: No OTP detected.");
            }
        } else {
            console.log("Creating a temporary email address...");
            try {
                const inbox = await client.createInbox();
                const email = inbox.address;
                console.log(`\nCreated successfully! Alamat email: \x1b[1m\x1b[32m${email}\x1b[0m`);
                console.log("Token pemilik (owner_token):", redact(inbox.owner_token));
                console.log("\nAnda bisa mengirimkan email ke alamat ini sekarang.");
                console.log("Menunggu email masuk dan mendeteksi kode verifikasi (OTP)...");

                const otp = await client.waitForOtp(email, 180000);
                if (otp) {
                    console.log(`\n\x1b[1m\x1b[36mKODE VERIFIKASI / OTP TERDETEKSI: ${otp}\x1b[0m\n`);
                } else {
                    console.log("\nTidak ada email baru / OTP terdeteksi dalam 3 menit.");
                }
            } catch (e) {
                console.error("Error:", e.message);
            }
        }
    })();
}
