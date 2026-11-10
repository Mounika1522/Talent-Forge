// Local fake SMTP server for manual testing. Nothing leaves your machine.
//   node tests/helpers/smtp-stub-cli.js 2525 mails.jsonl
// then set in backend/.env:  SMTP_HOST=127.0.0.1  SMTP_PORT=2525  SMTP_SECURE=false  SMTP_USER=x  SMTP_PASS=x
import fs from "node:fs";
import { startSmtpStub } from "./smtpStub.js";

const port = Number(process.argv[2] || 2525);
const file = process.argv[3] || "mails.jsonl";
const stub = await startSmtpStub(port);
console.log(`Fake SMTP server listening on 127.0.0.1:${stub.port}, writing received mails to ${file}`);
let written = 0;
setInterval(() => {
  while (written < stub.mails.length) {
    const m = stub.mails[written++];
    fs.appendFileSync(file, JSON.stringify({ to: m.to, subject: m.subject, replyTo: m.replyTo }) + "\n");
    console.log("Mail received for", m.to.join(", "), "-", m.subject);
  }
}, 200);
