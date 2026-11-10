# Talent Forge — React frontend + Node/Express backend

## Requirements
- Node.js 20+ and npm
- MongoDB running locally or a MongoDB Atlas connection
- SMTP credentials from an approved Alpha Auron email provider

## 1. Configure backend
Open a terminal in `backend`:
```bash
cd backend
npm install
```
Copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET`, admin password hash, and SMTP details. Never commit `.env`.

Generate a bcrypt hash for the admin password:
```bash
node -e "import('bcryptjs').then(async b => console.log(await b.hash('Choose-A-Strong-Password', 12)))"
```
Copy the generated hash into `ADMIN_PASSWORD_HASH`. Set `ADMIN_USERNAME` to your chosen username. Replace the example JWT secret with a long random secret.

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM` using approved company credentials. Confirm that the sender is authorized to send through that SMTP server. The recipients default to `krish@alphaauron.com` and `santhan@alphaauron.com`; `EMPLOYEE_EMAIL` is set to `tejaswi@alphaauron.com` in the example and must be verified by the company before production. Email is not sent until SMTP is configured.

Start the API:
```bash
npm run dev
```
Health check: `http://localhost:4000/api/health`

## 2. Run frontend
Open a second terminal in the project root (`Talent_Forge`):
```bash
npm install
npm run dev
```
Open the Vite URL printed in the terminal, usually `http://localhost:5173`. Admin route: `/admin`.

Optional: create a root `.env` file containing `VITE_API_URL=http://localhost:4000/api` if the API runs elsewhere.

## Implemented
- Enquiries are validated and saved to MongoDB before any email attempts.
- New lead notifications to configured notification recipients and employee address.
- Thank-you acknowledgement to the submitted email after database save.
- Lead IDs, admin JWT login, authenticated list/update/delete routes, CSV export in the frontend.
- Lead status and follow-up notes saved through the backend.

## Important production notes
- This starter is not production-deployed. Set a real `ADMIN_DASHBOARD_URL` in backend `.env` before sending notification emails.
- Verify Tejaswi's official company email before enabling that recipient.
- Use a managed database, HTTPS, backups, secrets management, and company-approved SMTP credentials for deployment.
- MongoDB is the primary data store. The central Excel workbook synchronization requirement still needs to be configured/implemented separately before this is treated as complete for the assignment.
- SMTP failures do not delete the enquiry; the response reports that email is not configured or delivery failed. Add durable retry/monitoring before production.
- Do not put SMTP credentials or admin passwords in frontend code.

## Email notifications (3 team members + thank-you to the customer)
Every new enquiry sends these emails (after the enquiry is saved, so a mail problem never loses a lead):
1. A "New Talent Forge Membership Enquiry" email to each address in `NOTIFY_EMAILS` and to `EMPLOYEE_EMAIL` (3 people in the example `.env`). Each person gets a separate email; Reply-To is the customer.
2. A "Thank You for Your Interest in Talent Forge!" email to the address the customer entered, with their reference ID.

Emails only go out when `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are set. The result for each recipient (sent/failed and why) is stored on the lead and shown in the lead details window. If some emails fail (SMTP down, wrong address), open the lead and press **Resend failed emails**. Only the failed ones are retried.
"Sent" means the SMTP server accepted the message. It cannot prove the message reached the inbox.

Try it without a real mail account (nothing leaves your computer):
```bash
cd backend
npm run mail:stub          # fake SMTP on 127.0.0.1:2525, writes mails.jsonl
# in .env: SMTP_HOST=127.0.0.1  SMTP_PORT=2525  SMTP_SECURE=false  SMTP_USER=x  SMTP_PASS=x
```

## Admin notification bell
New enquiries create one notification each (`notifications` collection, unique per lead). The bell in the admin dashboard shows the unread count, refreshes every 12 seconds, and supports All / Unread / Read, Mark all as read and Clear read (enquiries are never deleted by this). Clicking a notification marks it read and opens that lead's details. API (all need the admin JWT): `GET /api/notifications?filter=`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`, `DELETE /api/notifications/read`.

## Tests
```bash
cd backend
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test   # uses a temporary database and a local fake SMTP server
```
