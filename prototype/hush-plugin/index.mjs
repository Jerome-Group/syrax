const watched = [
  "reply_payload_sending",
  "message_sending",
  "message_sent",
  "before_dispatch",
  "reply_dispatch",
  "before_agent_finalize",
  "agent_end",
];

export default {
  id: "syrax-hush",
  name: "Syrax hush spike",
  register(api) {
    for (const name of watched) {
      api.on(name, async (event) => {
        const payload = event?.payload ?? {};
        const text = String(payload.text ?? event?.content ?? "").slice(0, 70).replace(/\n/g, " ");
        process.stderr.write(
          `[hush] ${name} notice=${Boolean(payload.isFallbackNotice)} text="${text}"\n`,
        );
        if (name === "reply_payload_sending" && payload.isFallbackNotice) {
          return { cancel: true };
        }
        return undefined;
      });
    }
  },
};
