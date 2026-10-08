/**
 * Plain-language copy for the outreach surfaces. Everything a nonprofit reads
 * here is written to be understood on the first pass: short sentences, one
 * idea each, no jargon. Keep every sentence honest: the app never claims to
 * know what a funder thinks.
 */
export const OUTREACH_COPY = {
  title: "Outreach",
  subtitle: "Write to funders, approve each message yourself, and keep a record of every contact.",

  tabs: {
    drafts: "Drafts",
    approved: "Approved",
    sent: "Sent",
    replied: "Replied",
  },
  tabHelp: {
    drafts: "Messages you are still working on. Nothing here has been sent.",
    approved: "Messages you have approved. Email goes out on the next send run. Letters and calls are recorded by hand.",
    sent: "Messages that left your connected Gmail, or that you recorded as sent by hand.",
    replied: "Messages where the funder wrote back. Pending follow-ups to that contact were canceled.",
  },

  empty: {
    drafts: "No drafts yet. Pick a saved funder and a template to write the first one.",
    approved: "Nothing is waiting to be sent.",
    sent: "Nothing has been sent yet.",
    replied: "No replies recorded yet. Replies are found when you check Gmail, or you can record one by hand.",
  },

  approval: {
    explain:
      "Approving is your signature. Each message is approved one at a time by a person. There is no bulk approve.",
    checks: "Before approval the app checks that the contact has an email address, that the address is not on your do-not-contact list, and that no [add: …] markers are left in the text.",
  },

  ai: {
    polishLabel: "Polish with AI",
    polishHelp:
      "The model rewrites your draft using only facts from the funder's filings and your own profile. Every factual sentence it keeps is listed with its source. Costs 2 credits.",
    labelReason: "This text was rewritten by a model. Read it before you approve it.",
  },

  sending: {
    needsPro: "Sending through your own Gmail is part of the Pro plan and above.",
    notConnected: "Connect your Gmail in Outreach settings to send approved email from the app.",
    runNow: "Send approved email now",
    checkReplies: "Check Gmail for replies",
    byHand: "Record as sent by hand",
    byHandHelp: "Use this when you sent the message yourself: from your own mail, by post, or by phone.",
  },

  contacts: {
    useFiling: "Use this contact",
    useFilingHelp:
      "Copies a role-based contact (such as a grants inbox or office phone) that the funder listed in its public filing. Personal details are never copied.",
    none: "No contacts yet for this funder.",
    noEmail: "This contact has no email address, so email cannot be approved. Add an address, or record a letter or call instead.",
  },

  suppress: {
    title: "Do-not-contact list",
    help: "Addresses and domains here never receive email from this workspace, even if a message was approved earlier.",
  },

  gmail: {
    scopes: "The app asks Google for two permissions: send email as you, and read message headers (sender, date, subject) so it can see that a reply arrived. It cannot read the text of your mail.",
    disconnect: "Disconnect removes the saved connection and asks Google to revoke it.",
  },
} as const;
