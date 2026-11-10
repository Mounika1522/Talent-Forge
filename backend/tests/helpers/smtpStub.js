import { SMTPServer } from "smtp-server";

// A tiny real SMTP server for tests: records every message and can reject chosen recipients.
export async function startSmtpStub(port = 0) {
  const mails = [];
  const reject = new Set();
  const server = new SMTPServer({
    secure: false,
    authOptional: true,
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    onAuth(_auth, _session, cb) { cb(null, { user: "test" }); },
    onRcptTo(address, _session, cb) {
      if (reject.has(address.address.toLowerCase())) {
        const err = new Error("Mailbox unavailable");
        err.responseCode = 550;
        return cb(err);
      }
      cb();
    },
    onData(stream, session, cb) {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        mails.push({
          to: session.envelope.rcptTo.map((r) => r.address.toLowerCase()),
          subject: (raw.match(/^Subject: (.*)$/mi) || [])[1] || "",
          replyTo: (raw.match(/^Reply-To: (.*)$/mi) || [])[1] || "",
          raw
        });
        cb();
      });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { mails, reject, port: server.server.address().port, close: () => new Promise((r) => server.close(r)) };
}
