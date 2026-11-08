// The Worker's entry: index.ts with the send_email binding attached. Kept apart so the tests, which run under Bun,
// never import cloudflare:email.
import { EmailMessage } from "cloudflare:email";
import { type ApexEnv, handle } from "./index";

type SendEmail = { send: (message: EmailMessage) => Promise<void> };

export default {
	fetch: (
		request: Request,
		env: ApexEnv & { EARLY_ACCESS_EMAIL?: SendEmail },
	): Promise<Response> => {
		const binding = env.EARLY_ACCESS_EMAIL;
		return handle(
			request,
			env,
			fetch,
			binding &&
				((from, to, raw) => binding.send(new EmailMessage(from, to, raw))),
		);
	},
};
