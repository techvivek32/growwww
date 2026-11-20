import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * The MNHA user agreement — presented like a formal contract on a letterhead,
 * in English, Hindi and Gujarati, with audio; identity photos can be taken on a phone via a QR code.
 *
 * The English text is the canonical version that gets hashed into every consent
 * record (with the language the user actually read/heard). The record — server
 * timestamp, IP, user-agent, signature, media — is the artifact, not the timer.
 *
 * NOTE (kept deliberately): this agreement makes NO guaranteed-return or
 * loss-protection offer. Such a scheme is unlawful in India without SEBI
 * registration and is intentionally absent.
 */

export const AGREEMENT_VERSION = "3.6 · 2026-11-20";

/**
 * Earlier versions that still count as signed. A member who signed one of these
 * keeps full access without signing again; everyone who signs from now on signs
 * AGREEMENT_VERSION. 3.5, 3.4 and 3.3 stay accepted so the members who signed them
 * are not made to sign again — the owner's decision: clients agree to the
 * automatic strategy (3.6, section 4) on paper as well.
 */
export const STILL_ACCEPTED_VERSIONS: readonly string[] = ["3.5 · 2026-11-20", "3.4 · 2026-11-19", "3.3 · 2026-10-03"];
const ACCEPTED_VERSIONS = new Set<string>([AGREEMENT_VERSION, ...STILL_ACCEPTED_VERSIONS]);
/** Whether a signed version still counts as signed. */
export const isAcceptedVersion = (v: string): boolean => ACCEPTED_VERSIONS.has(v);
/** Earlier versions whose signers are invited (a notice; nothing is blocked) to sign the
 *  current one: every earlier one, since none describes the automatic strategy. */
export const INVITE_TO_SIGN: readonly string[] = ["3.5 · 2026-11-20", "3.4 · 2026-11-19", "3.3 · 2026-10-03"];

/** The refusal for an action that needs a signed agreement. */
export const SIGN_FIRST = "Sign the MNHA agreement first — reload this page to continue.";

export type Lang = "en" | "hi" | "gu";
export const LANGS: { code: Lang; label: string; ttsLang: string }[] = [
  { code: "en", label: "English", ttsLang: "en-IN" },
  { code: "hi", label: "हिन्दी", ttsLang: "hi-IN" },
  { code: "gu", label: "ગુજરાતી", ttsLang: "gu-IN" },
];

/** The separate consents asked for at signing. Never pre-ticked. */
export type ConsentKey = "account" | "identity" | "groww" | "risk" | "marketing" | "analytics";
export const CONSENT_KEYS: { key: ConsentKey; required: boolean }[] = [
  { key: "account", required: true },
  { key: "identity", required: true },
  { key: "groww", required: true },
  { key: "risk", required: true },
  { key: "marketing", required: false },
  { key: "analytics", required: false },
];
export const OPTIONAL_CONSENTS: ConsentKey[] = CONSENT_KEYS.filter((c) => !c.required).map((c) => c.key);

export interface Section { heading: string; body: string }
export interface ConsentText { key: ConsentKey; label: string; text: string }
export interface ContractLang {
  title: string;
  org: { name: string; tagline: string; meta: string };
  intro: string;
  sections: Section[];
  consents: ConsentText[];
  spokenAck: string;
  ui: Record<string, string>;
}

const en: ContractLang = {
  title: "User Agreement, Risk Disclosure & Data Consent",
  org: { name: "MNHA FINANCIALS", tagline: "Your account, in plain sight.", meta: `Agreement version ${AGREEMENT_VERSION}` },
  intro:
    "This agreement between you and MNHA Financials covers what the service is, the risks of trading, and how we handle your personal data. Read it in full — or listen to it — in English, हिन्दी or ગુજરાતી, then give the separate consents at the end and sign. You accept it once per version. Choose a language you understand before you consent. The English text is the reference version.",
  sections: [
    { heading: "1. Who we are", body: "MNHA Financials (“MNHA”, “we”) provides the software at mnhafinancials.com and is responsible for your personal data under this agreement (the Data Fiduciary). Contact and grievances: support@mnhafinancials.com. MNHA is independent and is not affiliated with, sponsored by or endorsed by Groww." },
    { heading: "2. What MNHA is — and is not", body: "MNHA is software that connects to your own Groww account: it shows you the account, sends the orders you place on its order ticket, and runs in your account the automatic intraday strategy described in section 4. It is not a stock broker or bank, and it is not registered with SEBI as a portfolio manager, Research Analyst or Investment Adviser. It holds none of your money or securities (zero custody), and the API key you give it cannot withdraw money. Your trading account stays with your broker." },
    { heading: "3. No tips, no recommendations", body: "MNHA does not give buy or sell tips, recommendations or investment advice. Nothing it shows — a strategy, its status, a market observation, an analysis or historical figures — is an instruction or a recommendation to buy, sell or hold any security. Apart from the automatic strategy in section 4 and the admin's orders in section 8, every decision — whether to trade, what, when, how much, at what price and when to exit — is yours alone. The outcome of every trade in your account, the strategy's included, is yours." },
    { heading: "4. The automatic strategy", body: "MNHA runs one automatic intraday strategy in the connected Groww accounts that take part. An account takes part when its Groww key has the static IP MNHA gave you (so MNHA can send orders), this agreement is signed, and at least the trade size is free in it, as checked shortly before the day's first strategy order (normally at 09:20). On a trading day the strategy may sell one F&O stock short at about 09:20 and buy it back later that day — once the average of the day's F&O stocks has risen 0.5% since 09:20 (checked at each 5-minute close), at about 10:15, at about 15:15, or sooner if MNHA can no longer watch the market — and it may buy one stock (possibly the same one) at about 10:15 and sell it at about 15:15. All of it is intraday (MIS): nothing is held overnight. Each trade is the same rupee size in every account that takes part — ₹5,00,000 unless MNHA changes it. These orders go to Groww from your account like any other order, without asking you first; each is recorded as the strategy's, and you are told of it at once in your MNHA notifications. The strategy also cancels its own orders that have not filled within a minute, and MNHA's resting orders on a position it closes. The strategy can lose money, on a single day and over months; its paper-trading and past results do not predict what it will do. Any profit or loss from it is entirely yours, and so are Groww's brokerage and charges on its trades. MNHA can switch the strategy off at any time: it then opens nothing new, while what it already opened that day is still closed as above. To keep your account out of it, write to support@mnhafinancials.com. Disconnecting Groww in Settings stops it at once — but a position it has already opened then stays open until you close it, or until Groww squares it off near the close." },
    { heading: "5. Trading is risky — no guarantee", body: "Trading and investing carry real risk, including losing your entire capital; leveraged products can lose more than you put in. There are no guaranteed returns, no guaranteed profits and no risk-free strategies, and any promise of guaranteed or zero-loss returns — from anyone — is false. Backtested, simulated and past results do not predict the future. SEBI's own studies found that roughly nine in ten individual traders in equity F&O lost money. Do not trade money you cannot afford to lose." },
    { heading: "6. Information we collect", body: "Account: your email address (confirmed with a one-time code we email you) and your password (stored only as a salted hash). Identity verification on this page: a selfie and a photo of your PAN or Aadhaar, and the details in them — used only to verify that you are the person opening the account, to keep evidence that you personally completed this agreement, and to protect account integrity. You can take them on your phone by scanning a QR code: that link works for 15 minutes and can only upload these two photos to your account. They are stored as soon as you upload them, even before you sign. If you also complete MNHA's optional verification, we collect your full name, PAN, date of birth, postal address, a selfie and an ID document, and may hold a live video call with you; PAN and date of birth are stored encrypted. Identity images are stored as files on our server, outside public access. We treat all of these as sensitive." },
    { heading: "7. Connecting your Groww account", body: "Connecting Groww is a separate step. You sign in on Groww's own website and create the API key and TOTP secret there; we never ask for, receive or see your Groww password, PIN or one-time OTP. We verify the key live with Groww and store it encrypted (AES-256). With it, MNHA reads your Groww client code and enabled segments, balance, holdings, positions, order book and fills, and the live quotes and option chains shown on your desk — to show your desk and to work out round-trip analysis from your actual fills — and sends the orders described in sections 4 and 8. Adding the static IP that MNHA gives you to your key is optional, but Groww accepts orders sent through its API only from the static IP registered on the key: without it MNHA cannot send any order to your account — yours, the automatic strategy's or the admin's — and your account does not take part in the strategy." },
    { heading: "8. Orders, and help from MNHA's admin", body: "Once your key has that static IP, you can place orders on your own Groww account from MNHA's order ticket. Each order you place is sent only after you confirm it, and only once — it is never repeated automatically. MNHA checks each order first and refuses one that breaks its limits (for example, its maximum quantity); an order that passes can still be rejected by Groww or the exchange. MNHA keeps a record of every order sent through it: what was sent, when, by whom, the result and Groww's order id. For support, MNHA's admin can open your account for up to one hour at a time and see what you see; every opening is logged with the time and the admin's IP. The admin can help you connect Groww — this is logged too — but cannot sign this agreement, change your consents or password, or take your identity photos for you. The admin can also place or cancel an order in your account, and — from MNHA's console — send the same order to several accounts at once or close open positions in them (for example, the strategy's positions): each goes to Groww like any other order, is recorded as the admin's, and you are told at once in your MNHA notifications." },
    { heading: "9. Why we use your information", body: "Only for the purposes in this agreement: creating, securing and running your account; signing you in; verifying your identity and recording your acknowledgement; connecting Groww when you ask and reading the permitted information; sending the orders you place, the automatic strategy's orders (section 4) and the admin's orders (section 8), and keeping a record of them; showing your desk and your analysis; helping you when you ask for support; keeping the service secure; meeting legal obligations; and handling your requests and grievances." },
    { heading: "10. Where your data is stored, and who processes it", body: "Your data is stored on our servers, run by our hosting provider (Hostinger) in the United States, so it is processed outside India. Groww supplies the account data you ask us to read and receives the orders sent from your account; public market data also comes from other market-data sources, and no personal data is sent to them. Account emails, such as your sign-up code, are sent through Google's Gmail service, which receives your email address and the message. If a live verification call is arranged, it takes place on the video-meeting service named in the invitation, and MNHA does not record it. If recorded read-aloud is switched on, only the text of this agreement is sent to Microsoft Azure to make the audio. We use no third-party analytics, advertising or marketing-email services today, and we do not sell your personal data." },
    { heading: "11. How long we keep it", body: "Your account details, identity materials (selfie, ID photo) and verification details: until you delete your account. Your Groww key and client code: until you disconnect Groww or delete your account, whichever comes first. The record of orders sent through MNHA (sections 4 and 8): its latest 5,000 entries, until you delete your account. The rest of your Groww account data is not stored — it is read live each time you open a page. Your consent records and notifications: until you delete your account. Membership invoices, if any: kept after account deletion as billing records, used only for accounting and legal purposes. Server logs used for security and troubleshooting rotate out automatically." },
    { heading: "12. Your rights and choices", body: "You may ask what personal data we process and how; access it; correct or update it; have it erased when it no longer needs to be kept; withdraw a consent; and raise a grievance. Withdrawing a consent does not undo processing that was lawful before it, and withdrawing a required consent may mean we cannot continue that part of the service." },
    { heading: "13. Withdrawing consent, disconnecting and deleting", body: "In Settings → Privacy & consents you can switch optional consents off at any time — as easily as you gave them. Settings → Disconnect broker removes your stored Groww key at once and records the withdrawal of your Groww consent; you can also revoke the key on Groww. Settings → Delete account erases your account and personal data immediately — everything except billing records and server logs, including the backup copies our software keeps (an active membership must be left, and any unpaid invoice settled, first; and on a trading day, any position or order that MNHA's automatic strategy or admin has open in your account that day must be closed first — deletion is possible again after 15:35 IST). Settings stays open to you even before you sign this version or connect Groww. You can also write to support@mnhafinancials.com." },
    { heading: "14. Marketing, analytics and cookies", body: "Marketing messages (email, SMS or WhatsApp) and non-essential analytics or cookies are optional, separate, and only for users who opt in; refusing or withdrawing them never limits the core service. Today we send no marketing and use no analytics tools or non-essential cookies — only a strictly necessary sign-in cookie (valid for eight hours) and a display-theme setting stored in your browser." },
    { heading: "15. Your consent record", body: "We keep evidence of your consent: the agreement version and its fingerprint, every language you viewed, each box you ticked, your typed signature, the date and time, your IP address and device, your selfie and ID photo, and any later change or withdrawal." },
    { heading: "16. The service, liability, changes and law", body: "The service is provided “as is”, without warranties, to the extent the law allows; it may be delayed, interrupted or show wrong data, so always check your broker for anything important. MNHA is not liable for trading losses, downtime or data errors. We may update this agreement; if a change is material, we will tell you in MNHA and ask you to review and sign the new version. It is governed by the laws of India, including the Digital Personal Data Protection Act, 2023 and its Rules." },
    { heading: "17. Questions and grievances", body: "For questions, data requests or grievances, write to support@mnhafinancials.com. We aim to respond within a couple of business days. Where the Digital Personal Data Protection Act applies, you may also use the remedies it gives a Data Principal, including a complaint to the Data Protection Board of India." },
  ],
  consents: [
    { key: "account", label: "Account, terms & privacy", text: "I agree to create an MNHA Financials account and accept this agreement, including the Terms of Use, Privacy Policy and Risk Disclosure. I understand that my personal data will be processed as described above." },
    { key: "identity", label: "Identity verification", text: "I consent to MNHA collecting and storing my selfie and photo ID to verify my identity and protect my account, as described above." },
    { key: "groww", label: "Groww connection and orders", text: "I consent to MNHA storing my Groww API key and TOTP secret in encrypted form and using them to read my Groww client code, balance, holdings, positions, order book, fills and live market data, to run my desk and my round-trip analysis, and to send to Groww the orders I confirm on MNHA's order ticket, the orders and cancellations of MNHA's automatic strategy described in section 4, and the orders, cancellations and position exits MNHA's admin makes in my account." },
    { key: "risk", label: "Status & risk", text: "I understand that MNHA is not a broker and is not registered as a portfolio manager, Research Analyst or Investment Adviser, that it does not recommend that I buy or sell any security, that its automatic strategy trades my account as described in section 4 and its profits and losses are mine, and that trading can cause substantial losses." },
    { key: "marketing", label: "Marketing", text: "I agree to receive optional MNHA marketing messages by email, SMS and/or WhatsApp. I can withdraw this at any time without losing the core service." },
    { key: "analytics", label: "Analytics & cookies", text: "I agree to optional analytics and non-essential cookies that help MNHA understand how its website and software are used. I can withdraw this at any time without losing essential functions." },
  ],
  spokenAck:
    "I am signing this of my own free will. I understand that MNHA Financials gives me no buy or sell tips, that its automatic intraday strategy trades my account as this agreement describes and its profits and losses are mine, that every other trading decision is my own responsibility, that trading is risky and I can lose money, and that there is no guaranteed return. I have read and understood this agreement.",
  ui: {
    timeDone: "Reading time complete",
    uploading: "Uploading…",
    uploadFailed: "Upload failed — please try again.",
    fileTooBig: "That photo is larger than 10 MB — please take it again at a lower size.",
    signName: "Type your full name to sign.",
    mediaStale: "For this signing, please add your selfie and ID photo again.",
    before: "Before you begin",
    subtitle: "Read or listen to the full agreement, verify your identity on your phone, give your consents and sign.",
    language: "Language",
    listen: "Listen",
    pause: "Pause",
    playing: "Reading aloud…",
    loadingAudio: "Preparing audio…",
    noVoice: "This browser has no voice for this language. Open the page in Microsoft Edge, or in Chrome on Android — or read the text above.",
    readToEnd: "Scroll to the end to continue",
    jumpToEnd: "Jump to the end",
    needRead: "Scroll the agreement to the end before ticking these.",
    retake: "Retake photos",
    retaking: "Clearing…",
    retakeHint: "Clears what you captured and gives you a fresh QR code.",
    readDone: "Read to the end",
    listenDone: "Listened to the agreement",
    timeLeft: "Please take a moment",
    endOfAgreement: "— End of agreement —",
    identity: "Verify your identity",
    selfie: "Selfie",
    idphoto: "PAN / Aadhaar photo",
    consentsTitle: "Your consents",
    consentsHint: "Tick each one separately. The four required ones are needed to use MNHA; the optional ones never are.",
    required: "Required",
    optional: "Optional",
    needRequired: "Please tick the four required consents.",
    signature: "Digital signature — type your full name",
    signaturePh: "Your full name",
    submit: "Provide consent & sign",
    submitting: "Recording your consent…",
    auditNote: "Signing records your name, the exact agreement version, the language you chose, each box you ticked, every language you viewed, and the date, time, IP and device — as an audit trail. The timer and audio are good-faith aids, not a legal guarantee.",
    needMedia: "Please add your selfie and PAN/Aadhaar photo first.",
    identityWait: "When the reading time is up, a QR code appears here — scan it with your phone to take your selfie and ID photo.",
    scanTitle: "Continue on your phone",
    scanHint: "Scan this QR code with your phone's camera, then take a selfie and a photo of your PAN or Aadhaar there. This page updates by itself.",
    scanExpires: "The link works for 15 minutes and can only upload these two photos.",
    scanRefresh: "New QR code",
    scanFailed: "Couldn't make the QR code. Try again, or upload from this computer.",
    waitingPhone: "Waiting for your phone…",
    useComputer: "No phone? Upload from this computer instead",
    declaration: "By signing, you confirm:",
    phoneTitle: "Verify your identity",
    phoneFor: "For the MNHA account",
    phoneSelfie: "Take a selfie",
    phoneSelfieHint: "Face the camera in good light.",
    phoneId: "Photo of your PAN or Aadhaar",
    phoneIdHint: "The whole card, flat and readable.",
    phoneTake: "Open camera",
    phoneRetake: "Retake",
    phoneDone: "All done. Go back to your computer to finish.",
    phoneExpired: "This link has expired. Make a new QR code on your computer.",
    phoneFailed: "Upload failed — please try again.",
    kycSteps: "Identity steps",
    kycSelfieIntro: "Look at the camera, keep your face inside the oval and blink twice. The photo is taken by itself.",
    kycLiveNote: "The blink check runs only on this phone. No video is recorded or sent — only the final photo.",
    kycStart: "Start the camera",
    kycStarting: "Getting the camera ready…",
    kycFaceNone: "Bring your face into the oval",
    kycFaceMany: "Only your face, please",
    kycFaceFar: "Come a little closer",
    kycFaceNear: "Move back a little",
    kycFaceCenter: "Centre your face in the oval",
    kycBlink: "Now blink slowly — twice",
    kycBlinkOnce: "Good — blink once more",
    kycHold: "Hold still…",
    kycTimeout: "We couldn't see two clear blinks. Face a light, hold the phone at eye level and blink slowly.",
    kycTryAgain: "Try again",
    kycSkipCheck: "Take the selfie without the blink check",
    kycManual: "Keep your face in the oval and tap the button.",
    kycCamDenied: "Camera access is blocked. Allow the camera for this site in your browser settings — or take a photo instead.",
    kycCamNone: "The live camera isn't available in this browser. Take a photo instead, or open this link in Chrome or Safari.",
    kycTakePhoto: "Take photo",
    kycUseThis: "Use this photo",
    kycLiveOk: "Blink check passed",
    kycCardTip: "Place your PAN or Aadhaar flat on a table, in good light, without glare. Keep the whole card inside the frame.",
    kycOpenCamera: "Open camera",
    kycGallery: "Choose from gallery",
    kycCardFit: "Fit the card inside the frame",
    kycCardHint: "PAN or Aadhaar — all four corners visible",
    kycBlurry: "This photo looks blurry. Hold the phone steady and retake it.",
    kycDark: "This photo is too dark. Move to better light and retake it.",
    kycGlare: "There is glare on the card. Tilt it slightly away from the light and retake it.",
    kycLooksGood: "Clear and readable.",
    kycUseAnyway: "It's readable — use it anyway",
    kycAllDone: "Both photos are uploaded.",
    kycRedo: "Take them again",
  },
};

const hi: ContractLang = {
  title: "उपयोगकर्ता अनुबंध, जोखिम प्रकटीकरण एवं डेटा सहमति",
  org: { name: "MNHA FINANCIALS", tagline: "आपका खाता, साफ़ नज़र में।", meta: `अनुबंध संस्करण ${AGREEMENT_VERSION}` },
  intro:
    "यह आपके और MNHA Financials के बीच का अनुबंध है। इसमें बताया गया है कि यह सेवा क्या है, ट्रेडिंग के जोखिम क्या हैं, और हम आपके व्यक्तिगत डेटा को कैसे संभालते हैं। इसे English, हिन्दी या ગુજરાતી में पूरा पढ़ें — या सुनें — फिर अंत में अलग-अलग सहमतियाँ दें और हस्ताक्षर करें। आप हर संस्करण को एक बार स्वीकार करते हैं। वह भाषा चुनें जो आप समझते हैं, फिर सहमति दें। अंग्रेज़ी पाठ संदर्भ संस्करण है।",
  sections: [
    { heading: "1. हम कौन हैं", body: "MNHA Financials (“MNHA”, “हम”) mnhafinancials.com पर सॉफ़्टवेयर उपलब्ध कराता है और इस अनुबंध के तहत आपके व्यक्तिगत डेटा के लिए ज़िम्मेदार है (डेटा फ़िड्यूशियरी)। संपर्क और शिकायत: support@mnhafinancials.com. MNHA स्वतंत्र है और Groww से संबद्ध, प्रायोजित या समर्थित नहीं है।" },
    { heading: "2. MNHA क्या है — और क्या नहीं", body: "MNHA सॉफ़्टवेयर है जो आपके अपने Groww खाते से जुड़ता है: यह आपको आपका खाता दिखाता है, MNHA के ऑर्डर टिकट पर आपके लगाए ऑर्डर भेजता है, और आपके खाते में खंड 4 में बताई गई स्वचालित इंट्राडे रणनीति चलाता है। यह स्टॉक ब्रोकर या बैंक नहीं है, और SEBI में पोर्टफ़ोलियो मैनेजर, रिसर्च एनालिस्ट या निवेश सलाहकार के रूप में पंजीकृत नहीं है। यह आपका कोई पैसा या प्रतिभूतियाँ नहीं रखता (शून्य कस्टडी), और जो API key आप देते हैं उससे पैसा नहीं निकाला जा सकता। आपका ट्रेडिंग खाता आपके ब्रोकर के पास ही रहता है।" },
    { heading: "3. कोई टिप नहीं, कोई सिफ़ारिश नहीं", body: "MNHA खरीद-बिक्री की टिप, सिफ़ारिश या निवेश सलाह नहीं देता। यह जो कुछ भी दिखाता है — कोई रणनीति, उसकी स्थिति, बाज़ार का अवलोकन, विश्लेषण या पुराने आँकड़े — वह किसी भी प्रतिभूति को खरीदने, बेचने या रखने का निर्देश या सिफ़ारिश नहीं है। खंड 4 की स्वचालित रणनीति और खंड 8 के एडमिन के ऑर्डर को छोड़कर, हर निर्णय — ट्रेड करना है या नहीं, क्या, कब, कितना, किस भाव पर और कब निकलना है — सिर्फ़ आपका है। आपके खाते के हर ट्रेड का परिणाम, रणनीति के ट्रेड सहित, आपका है।" },
    { heading: "4. स्वचालित रणनीति", body: "MNHA भाग लेने वाले जुड़े हुए Groww खातों में एक स्वचालित इंट्राडे रणनीति चलाता है। कोई खाता तब भाग लेता है जब उसकी Groww key पर MNHA का दिया स्टैटिक IP जुड़ा हो (ताकि MNHA ऑर्डर भेज सके), यह अनुबंध साइन हो, और उसमें कम से कम एक ट्रेड जितनी राशि खाली हो — जो दिन के पहले रणनीति-ऑर्डर से थोड़ा पहले (आमतौर पर 09:20 पर) जाँची जाती है। किसी ट्रेडिंग दिन रणनीति लगभग 09:20 पर किसी एक F&O स्टॉक को शॉर्ट बेच सकती है और उसी दिन बाद में वापस खरीद सकती है — जब उस दिन के F&O स्टॉक्स का औसत 09:20 से 0.5% चढ़ जाए (हर 5 मिनट की क्लोज़ पर जाँचा जाता है), लगभग 10:15 पर, लगभग 15:15 पर, या पहले ही, यदि MNHA बाज़ार पर नज़र न रख पाए — और लगभग 10:15 पर कोई एक स्टॉक (शायद वही) खरीदकर लगभग 15:15 पर बेच सकती है। यह सब इंट्राडे (MIS) है: रात भर कुछ भी नहीं रखा जाता। भाग लेने वाले हर खाते में हर ट्रेड का रुपये में आकार एक जैसा होता है — ₹5,00,000, जब तक MNHA इसे न बदले। ये ऑर्डर आपसे पहले पूछे बिना, किसी भी दूसरे ऑर्डर की तरह आपके खाते से Groww को जाते हैं; हर ऑर्डर रणनीति के नाम से दर्ज होता है, और आपको तुरंत आपकी MNHA सूचनाओं में बताया जाता है। रणनीति अपने वे ऑर्डर भी रद्द करती है जो एक मिनट में भरे न हों, और जिस पोज़िशन को वह बंद करती है उस पर MNHA के खड़े ऑर्डर भी। रणनीति से नुकसान हो सकता है, एक दिन में भी और महीनों में भी; इसके पेपर-ट्रेडिंग और पुराने परिणाम यह नहीं बताते कि यह आगे क्या करेगी। इससे होने वाला कोई भी मुनाफ़ा या नुकसान पूरी तरह आपका है, और इसके ट्रेडों पर Groww की ब्रोकरेज और शुल्क भी। MNHA रणनीति को कभी भी बंद कर सकता है: तब यह कुछ नया नहीं खोलती, जबकि उस दिन पहले से खोली गई पोज़िशन ऊपर बताए अनुसार बंद की जाती है। अपने खाते को इससे बाहर रखवाने के लिए support@mnhafinancials.com पर लिखें। Settings में Groww डिस्कनेक्ट करने से यह तुरंत रुक जाती है — लेकिन जो पोज़िशन यह पहले ही खोल चुकी है, वह तब तक खुली रहती है जब तक आप उसे बंद न करें या Groww बाज़ार बंद होने के पास उसे स्क्वेयर-ऑफ़ न कर दे।" },
    { heading: "5. ट्रेडिंग जोखिम भरी है — कोई गारंटी नहीं", body: "ट्रेडिंग और निवेश में वास्तविक जोखिम है, आपकी पूरी पूँजी डूब सकती है; लीवरेज वाले प्रोडक्ट में लगाई गई रकम से ज़्यादा नुकसान हो सकता है। कोई गारंटीड रिटर्न, गारंटीड मुनाफ़ा या जोखिम-मुक्त रणनीति नहीं है, और गारंटीड या ज़ीरो-लॉस रिटर्न का कोई भी वादा — किसी का भी — झूठा है। बैकटेस्ट, सिमुलेशन और पिछले नतीजे भविष्य नहीं बताते। SEBI के अपने अध्ययनों में पाया गया कि इक्विटी F&O में लगभग दस में से नौ व्यक्तिगत ट्रेडरों को नुकसान हुआ। वह पैसा ट्रेड न करें जिसे खोना आप सहन नहीं कर सकते।" },
    { heading: "6. हम कौन-सी जानकारी लेते हैं", body: "खाता: आपका ईमेल पता (जिसकी पुष्टि हम आपको ईमेल किए गए एक बार के कोड से करते हैं) और पासवर्ड (केवल सॉल्टेड हैश के रूप में रखा जाता है)। इस पेज पर पहचान सत्यापन: एक सेल्फ़ी और आपके PAN या आधार की फ़ोटो, और उनमें मौजूद विवरण — केवल यह सत्यापित करने के लिए कि खाता खोलने वाले आप ही हैं, यह प्रमाण रखने के लिए कि यह अनुबंध आपने स्वयं पूरा किया, और खाते की सुरक्षा के लिए। आप QR कोड स्कैन करके ये फ़ोटो अपने फ़ोन पर ले सकते हैं: वह लिंक 15 मिनट तक काम करता है और आपके खाते में केवल ये दो फ़ोटो अपलोड कर सकता है। अपलोड करते ही ये रख लिए जाते हैं, साइन करने से पहले भी। यदि आप MNHA का वैकल्पिक सत्यापन भी करते हैं, तो हम आपका पूरा नाम, PAN, जन्मतिथि, डाक पता, एक सेल्फ़ी और एक ID दस्तावेज़ लेते हैं, और आपके साथ एक लाइव वीडियो कॉल कर सकते हैं; PAN और जन्मतिथि एन्क्रिप्टेड रखे जाते हैं। पहचान की तस्वीरें हमारे सर्वर पर फ़ाइलों के रूप में, सार्वजनिक पहुँच से बाहर रखी जाती हैं। हम इन सबको संवेदनशील मानते हैं।" },
    { heading: "7. आपका Groww खाता जोड़ना", body: "Groww जोड़ना एक अलग चरण है। आप Groww की अपनी वेबसाइट पर साइन इन करते हैं और वहीं API key और TOTP secret बनाते हैं; हम आपका Groww पासवर्ड, PIN या OTP कभी नहीं माँगते, न प्राप्त करते हैं, न देखते हैं। हम key को Groww से लाइव सत्यापित करते हैं और उसे एन्क्रिप्टेड (AES-256) रखते हैं। इससे MNHA आपका Groww क्लाइंट कोड और चालू सेगमेंट, बैलेंस, होल्डिंग्स, पोज़िशन, ऑर्डर बुक और फ़िल, और आपकी डेस्क पर दिखने वाले लाइव भाव व ऑप्शन चेन पढ़ता है — ताकि आपकी डेस्क दिखा सके और आपके असली फ़िल से राउंड-ट्रिप विश्लेषण कर सके — और खंड 4 और 8 में बताए गए ऑर्डर भेजता है। MNHA जो स्टैटिक IP आपको देता है, उसे अपनी key पर जोड़ना वैकल्पिक है, लेकिन Groww अपने API से भेजे गए ऑर्डर केवल key पर पंजीकृत स्टैटिक IP से ही स्वीकार करता है: इसके बिना MNHA आपके खाते में कोई भी ऑर्डर नहीं भेज सकता — न आपका, न स्वचालित रणनीति का, न एडमिन का — और आपका खाता रणनीति में भाग नहीं लेता।" },
    { heading: "8. ऑर्डर, और MNHA के एडमिन से सहायता", body: "जब आपकी key पर वह स्टैटिक IP जुड़ जाता है, तब आप MNHA के ऑर्डर टिकट से अपने ही Groww खाते में ऑर्डर लगा सकते हैं। आपका लगाया हर ऑर्डर आपकी पुष्टि के बाद ही भेजा जाता है, और केवल एक बार — वह अपने-आप कभी दोहराया नहीं जाता। MNHA हर ऑर्डर पहले जाँचता है और अपनी सीमाएँ (जैसे अधिकतम मात्रा) तोड़ने वाला ऑर्डर अस्वीकार करता है; जो ऑर्डर इस जाँच में पास हो जाए, उसे भी Groww या एक्सचेंज अस्वीकार कर सकता है। MNHA अपने ज़रिए भेजे गए हर ऑर्डर का रिकॉर्ड रखता है: क्या भेजा गया, कब, किसने, उसका परिणाम और Groww का ऑर्डर ID। सहायता के लिए, MNHA का एडमिन एक बार में अधिकतम एक घंटे के लिए आपका खाता खोल सकता है और जो आप देखते हैं, वह देख सकता है; एडमिन जब भी आपका खाता खोलता है, यह समय और एडमिन के IP के साथ लॉग होता है। एडमिन Groww जोड़ने में आपकी मदद कर सकता है — यह भी लॉग होता है — लेकिन आपकी ओर से यह अनुबंध साइन नहीं कर सकता, आपकी सहमतियाँ या पासवर्ड नहीं बदल सकता, और आपकी पहचान की फ़ोटो नहीं ले सकता। एडमिन आपके खाते में ऑर्डर लगा या रद्द भी कर सकता है, और MNHA के कंसोल से एक ही ऑर्डर कई खातों में एक साथ भेज सकता है या उनमें खुली पोज़िशन बंद कर सकता है (जैसे रणनीति की पोज़िशन): हर ऑर्डर किसी भी दूसरे ऑर्डर की तरह Groww को जाता है, एडमिन के नाम से दर्ज होता है, और आपको तुरंत आपकी MNHA सूचनाओं में बताया जाता है।" },
    { heading: "9. हम आपकी जानकारी का उपयोग क्यों करते हैं", body: "केवल इस अनुबंध में बताए उद्देश्यों के लिए: आपका खाता बनाना, सुरक्षित रखना और चलाना; आपको साइन इन कराना; आपकी पहचान सत्यापित करना और आपकी स्वीकृति दर्ज करना; आपके कहने पर Groww जोड़ना और अनुमत जानकारी पढ़ना; आपके लगाए ऑर्डर, स्वचालित रणनीति के ऑर्डर (खंड 4) और एडमिन के ऑर्डर (खंड 8) भेजना और उनका रिकॉर्ड रखना; आपकी डेस्क और विश्लेषण दिखाना; आपके माँगने पर सहायता देना; सेवा को सुरक्षित रखना; कानूनी दायित्व पूरे करना; और आपके अनुरोध व शिकायतें संभालना।" },
    { heading: "10. आपका डेटा कहाँ रखा जाता है और कौन प्रोसेस करता है", body: "आपका डेटा हमारे सर्वरों पर रखा जाता है, जिन्हें हमारा होस्टिंग प्रदाता (Hostinger) संयुक्त राज्य अमेरिका में चलाता है, यानी इसकी प्रोसेसिंग भारत के बाहर होती है। आप जिस खाता-डेटा को पढ़ने के लिए कहते हैं, वह Groww देता है, और आपके खाते से भेजे गए ऑर्डर Groww प्राप्त करता है; सार्वजनिक बाज़ार-डेटा अन्य बाज़ार-डेटा स्रोतों से भी आता है, और उन्हें कोई व्यक्तिगत डेटा नहीं भेजा जाता। खाते से जुड़े ईमेल, जैसे साइन-अप कोड, Google की Gmail सेवा से भेजे जाते हैं, जिसे आपका ईमेल पता और संदेश मिलता है। यदि लाइव सत्यापन कॉल तय होती है, तो वह निमंत्रण में बताई गई वीडियो-मीटिंग सेवा पर होती है, और MNHA उसे रिकॉर्ड नहीं करता। यदि रिकॉर्ड की गई ऑडियो सुविधा चालू है, तो ऑडियो बनाने के लिए केवल इस अनुबंध का पाठ Microsoft Azure को भेजा जाता है। आज हम कोई थर्ड-पार्टी एनालिटिक्स, विज्ञापन या ईमेल-मार्केटिंग सेवा उपयोग नहीं करते, और हम आपका व्यक्तिगत डेटा नहीं बेचते।" },
    { heading: "11. हम इसे कितने समय तक रखते हैं", body: "आपके खाते का विवरण, पहचान सामग्री (सेल्फ़ी, ID फ़ोटो) और सत्यापन विवरण: जब तक आप अपना खाता नहीं हटाते। आपकी Groww key और क्लाइंट कोड: जब तक आप Groww डिस्कनेक्ट नहीं करते या खाता नहीं हटाते — जो पहले हो। MNHA के ज़रिए भेजे गए ऑर्डर का रिकॉर्ड (खंड 4 और 8): उसकी नवीनतम 5,000 प्रविष्टियाँ, जब तक आप खाता नहीं हटाते। आपके Groww खाते का बाकी डेटा रखा नहीं जाता — हर बार पेज खोलने पर लाइव पढ़ा जाता है। आपके सहमति रिकॉर्ड और सूचनाएँ: जब तक आप खाता नहीं हटाते। मेंबरशिप इनवॉइस, यदि कोई हों: खाता हटाने के बाद भी बिलिंग रिकॉर्ड के रूप में रखे जाते हैं, केवल लेखा और कानूनी उद्देश्यों के लिए। सुरक्षा और समस्या-निवारण के सर्वर लॉग अपने-आप रोटेट होकर हट जाते हैं।" },
    { heading: "12. आपके अधिकार और विकल्प", body: "आप पूछ सकते हैं कि हम आपका कौन-सा व्यक्तिगत डेटा कैसे प्रोसेस करते हैं; उसे देख सकते हैं; उसे सुधार या अपडेट कर सकते हैं; ज़रूरत न रहने पर उसे मिटवा सकते हैं; कोई सहमति वापस ले सकते हैं; और शिकायत कर सकते हैं। सहमति वापस लेने से पहले हुई वैध प्रोसेसिंग अमान्य नहीं होती, और कोई ज़रूरी सहमति वापस लेने पर संभव है कि हम सेवा का वह हिस्सा जारी न रख पाएँ।" },
    { heading: "13. सहमति वापस लेना, डिस्कनेक्ट करना और खाता हटाना", body: "Settings → “Privacy & consents” (प्राइवेसी और सहमतियाँ) में आप वैकल्पिक सहमतियाँ कभी भी बंद कर सकते हैं — उतनी ही आसानी से, जितनी आसानी से आपने उन्हें दिया था। Settings → “Disconnect broker” (ब्रोकर डिस्कनेक्ट करें) से आपकी Groww key तुरंत हट जाती है और आपकी Groww सहमति की वापसी दर्ज होती है; आप Groww पर भी key रद्द कर सकते हैं। Settings → “Delete account” (खाता हटाएँ) से आपका खाता और व्यक्तिगत डेटा तुरंत मिट जाता है — बिलिंग रिकॉर्ड और सर्वर लॉग को छोड़कर सब कुछ, हमारे सॉफ़्टवेयर की बैकअप प्रतियों सहित (पहले चालू मेंबरशिप छोड़नी होगी और बकाया इनवॉइस चुकाना होगा; और किसी ट्रेडिंग दिन, MNHA की स्वचालित रणनीति या एडमिन की उस दिन आपके खाते में खुली कोई भी पोज़िशन या ऑर्डर पहले बंद होना चाहिए — 15:35 IST के बाद खाता फिर से हटाया जा सकता है)। यह संस्करण साइन करने या Groww जोड़ने से पहले भी Settings आपके लिए खुला रहता है। आप support@mnhafinancials.com पर भी लिख सकते हैं।" },
    { heading: "14. मार्केटिंग, एनालिटिक्स और कुकीज़", body: "मार्केटिंग संदेश (ईमेल, SMS या WhatsApp) और गैर-ज़रूरी एनालिटिक्स या कुकीज़ वैकल्पिक और अलग हैं, और केवल सहमति देने वालों के लिए हैं; इन्हें मना करने या वापस लेने से मूल सेवा कभी सीमित नहीं होती। आज हम कोई मार्केटिंग नहीं भेजते और कोई एनालिटिक्स टूल या गैर-ज़रूरी कुकी उपयोग नहीं करते — केवल एक अनिवार्य साइन-इन कुकी (आठ घंटे के लिए मान्य) और आपके ब्राउज़र में रखी गई थीम सेटिंग।" },
    { heading: "15. आपकी सहमति का रिकॉर्ड", body: "हम आपकी सहमति का प्रमाण रखते हैं: अनुबंध का संस्करण और उसका फ़िंगरप्रिंट, आपके द्वारा देखी गई हर भाषा, आपके द्वारा टिक किया गया हर बॉक्स, आपका टाइप किया हस्ताक्षर, दिनांक और समय, आपका IP पता और डिवाइस, आपकी सेल्फ़ी और ID फ़ोटो, और बाद का कोई भी बदलाव या वापसी।" },
    { heading: "16. सेवा, दायित्व, बदलाव और कानून", body: "सेवा “जैसी है वैसी”, बिना वारंटी के, कानून की अनुमति तक दी जाती है; इसमें देरी, रुकावट या गलत डेटा हो सकता है, इसलिए ज़रूरी बात हमेशा अपने ब्रोकर पर जाँचें। MNHA ट्रेडिंग नुकसान, डाउनटाइम या डेटा त्रुटि के लिए ज़िम्मेदार नहीं है। हम यह अनुबंध बदल सकते हैं; बड़ा बदलाव होने पर हम MNHA में आपको बताएँगे और आपसे नया संस्करण देखकर साइन करने के लिए कहेंगे। यह भारत के कानूनों के अधीन है, जिसमें डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 और उसके नियम शामिल हैं।" },
    { heading: "17. प्रश्न और शिकायतें", body: "प्रश्न, डेटा अनुरोध या शिकायत के लिए support@mnhafinancials.com पर लिखें। हम कुछ कार्यदिवसों में जवाब देने का प्रयास करते हैं। जहाँ डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम लागू होता है, वहाँ आप डेटा प्रिंसिपल को मिलने वाले उपाय भी अपना सकते हैं, जिसमें भारतीय डेटा संरक्षण बोर्ड में शिकायत शामिल है।" },
  ],
  consents: [
    { key: "account", label: "खाता, शर्तें और प्राइवेसी", text: "मैं MNHA Financials खाता बनाने और यह अनुबंध — उपयोग की शर्तें, प्राइवेसी नीति और जोखिम प्रकटीकरण सहित — स्वीकार करने के लिए सहमत हूँ। मैं समझता/समझती हूँ कि मेरा व्यक्तिगत डेटा ऊपर बताए अनुसार प्रोसेस होगा।" },
    { key: "identity", label: "पहचान सत्यापन", text: "मैं अपनी पहचान सत्यापित करने और अपने खाते की सुरक्षा के लिए MNHA को मेरी सेल्फ़ी और फ़ोटो ID लेने और रखने की सहमति देता/देती हूँ, जैसा ऊपर बताया गया है।" },
    { key: "groww", label: "Groww कनेक्शन और ऑर्डर", text: "मैं सहमति देता/देती हूँ कि MNHA मेरी Groww API key और TOTP secret एन्क्रिप्टेड रखे और उनसे मेरा Groww क्लाइंट कोड, बैलेंस, होल्डिंग्स, पोज़िशन, ऑर्डर बुक, फ़िल और लाइव बाज़ार-डेटा पढ़े, ताकि मेरी डेस्क और राउंड-ट्रिप विश्लेषण चल सके, और Groww को वे ऑर्डर भेजे जिनकी मैं MNHA के ऑर्डर टिकट पर पुष्टि करूँ, खंड 4 में बताई गई MNHA की स्वचालित रणनीति के ऑर्डर और रद्दीकरण, तथा वे ऑर्डर, रद्दीकरण और पोज़िशन से निकास भी, जो MNHA का एडमिन मेरे खाते में करे।" },
    { key: "risk", label: "स्थिति और जोखिम", text: "मैं समझता/समझती हूँ कि MNHA ब्रोकर नहीं है और पोर्टफ़ोलियो मैनेजर, रिसर्च एनालिस्ट या निवेश सलाहकार के रूप में पंजीकृत नहीं है, मुझे कोई प्रतिभूति खरीदने या बेचने की सिफ़ारिश नहीं करता, उसकी स्वचालित रणनीति खंड 4 के अनुसार मेरे खाते में ट्रेड करती है और उसका मुनाफ़ा-नुकसान मेरा है, और ट्रेडिंग से भारी नुकसान हो सकता है।" },
    { key: "marketing", label: "मार्केटिंग", text: "मैं ईमेल, SMS और/या WhatsApp से MNHA के वैकल्पिक मार्केटिंग संदेश पाने के लिए सहमत हूँ। मैं इसे कभी भी वापस ले सकता/सकती हूँ, मूल सेवा खोए बिना।" },
    { key: "analytics", label: "एनालिटिक्स और कुकीज़", text: "मैं वैकल्पिक एनालिटिक्स और गैर-ज़रूरी कुकीज़ के लिए सहमत हूँ, जिनसे MNHA समझ सके कि उसकी वेबसाइट और सॉफ़्टवेयर कैसे उपयोग होते हैं। मैं इसे कभी भी वापस ले सकता/सकती हूँ, ज़रूरी सुविधाएँ खोए बिना।" },
  ],
  spokenAck:
    "मैं यह अपनी मर्ज़ी से साइन कर रहा/रही हूँ। मैं समझता/समझती हूँ कि MNHA Financials मुझे खरीद-बिक्री की कोई टिप नहीं देता, कि उसकी स्वचालित इंट्राडे रणनीति इस अनुबंध के अनुसार मेरे खाते में ट्रेड करती है और उसका मुनाफ़ा-नुकसान मेरा है, कि ट्रेडिंग का हर दूसरा निर्णय मेरी अपनी ज़िम्मेदारी है, कि ट्रेडिंग जोखिम भरी है और मेरा पैसा डूब सकता है, और कोई गारंटीड रिटर्न नहीं है। मैंने यह अनुबंध पढ़ और समझ लिया है।",
  ui: {
    timeDone: "पढ़ने का समय पूरा",
    uploading: "अपलोड हो रहा है…",
    uploadFailed: "अपलोड नहीं हो सका — कृपया फिर कोशिश करें।",
    fileTooBig: "यह फ़ोटो 10 MB से बड़ी है — कृपया छोटे आकार में दोबारा लें।",
    signName: "साइन करने के लिए अपना पूरा नाम लिखें।",
    mediaStale: "इस बार साइन करने के लिए कृपया अपनी सेल्फ़ी और ID फ़ोटो फिर से जोड़ें।",
    before: "शुरू करने से पहले",
    subtitle: "पूरा अनुबंध पढ़ें या सुनें, फ़ोन पर अपनी पहचान सत्यापित करें, सहमतियाँ दें और साइन करें।",
    language: "भाषा", listen: "सुनें", pause: "रोकें", playing: "पढ़ा जा रहा है…", loadingAudio: "ऑडियो तैयार हो रहा है…",
    noVoice: "इस ब्राउज़र में इस भाषा की आवाज़ नहीं है। यह पेज Microsoft Edge में, या Android पर Chrome में खोलें — या ऊपर का पाठ पढ़ें।",
    readToEnd: "जारी रखने के लिए अंत तक स्क्रॉल करें",
    jumpToEnd: "अंत तक जाएँ",
    needRead: "इन्हें टिक करने से पहले अनुबंध को अंत तक स्क्रॉल करें।",
    retake: "फ़ोटो दोबारा लें",
    retaking: "हटाया जा रहा है…",
    retakeHint: "ली गई फ़ोटो हटाकर नया QR कोड देता है।",
    readDone: "अंत तक पढ़ लिया", listenDone: "अनुबंध सुन लिया",
    timeLeft: "कृपया एक पल रुकें", endOfAgreement: "— अनुबंध समाप्त —",
    identity: "अपनी पहचान सत्यापित करें", selfie: "सेल्फ़ी", idphoto: "PAN / आधार फ़ोटो",
    consentsTitle: "आपकी सहमतियाँ",
    consentsHint: "हर एक को अलग से टिक करें। चार ज़रूरी सहमतियाँ MNHA उपयोग करने के लिए चाहिए; वैकल्पिक कभी नहीं।",
    required: "ज़रूरी", optional: "वैकल्पिक", needRequired: "कृपया चारों ज़रूरी सहमतियाँ टिक करें।",
    signature: "डिजिटल हस्ताक्षर — अपना पूरा नाम लिखें", signaturePh: "आपका पूरा नाम",
    submit: "सहमति दें और साइन करें", submitting: "आपकी सहमति दर्ज हो रही है…",
    auditNote: "साइन करने पर आपका नाम, अनुबंध संस्करण, चुनी गई भाषा, आपके द्वारा टिक किया गया हर बॉक्स, तथा दिनांक, समय, IP और डिवाइस दर्ज होते हैं। टाइमर और ऑडियो सहायक हैं, कानूनी गारंटी नहीं।",
    needMedia: "कृपया पहले अपनी सेल्फ़ी और PAN/आधार फ़ोटो जोड़ें।",
    identityWait: "पढ़ने का समय पूरा होने पर यहाँ एक QR कोड आएगा — अपनी सेल्फ़ी और ID फ़ोटो लेने के लिए उसे अपने फ़ोन से स्कैन करें।",
    scanTitle: "अपने फ़ोन पर जारी रखें",
    scanHint: "इस QR कोड को अपने फ़ोन के कैमरे से स्कैन करें, फिर वहाँ एक सेल्फ़ी और अपने PAN या आधार की फ़ोटो लें। यह पेज अपने-आप अपडेट हो जाएगा।",
    scanExpires: "लिंक 15 मिनट तक काम करता है और केवल ये दो फ़ोटो अपलोड कर सकता है।",
    scanRefresh: "नया QR कोड",
    scanFailed: "QR कोड नहीं बन सका। फिर कोशिश करें, या इसी कंप्यूटर से अपलोड करें।",
    waitingPhone: "आपके फ़ोन का इंतज़ार है…",
    useComputer: "फ़ोन नहीं है? इसी कंप्यूटर से अपलोड करें",
    declaration: "साइन करके आप पुष्टि करते हैं:",
    phoneTitle: "अपनी पहचान सत्यापित करें",
    phoneFor: "MNHA खाते के लिए",
    phoneSelfie: "सेल्फ़ी लें",
    phoneSelfieHint: "अच्छी रोशनी में कैमरे की ओर देखें।",
    phoneId: "आपके PAN या आधार की फ़ोटो",
    phoneIdHint: "पूरा कार्ड, सीधा और पढ़ने योग्य।",
    phoneTake: "कैमरा खोलें",
    phoneRetake: "फिर से लें",
    phoneDone: "हो गया। पूरा करने के लिए अपने कंप्यूटर पर लौटें।",
    phoneExpired: "यह लिंक समाप्त हो गया है। अपने कंप्यूटर पर नया QR कोड बनाएँ।",
    phoneFailed: "अपलोड नहीं हो सका — कृपया फिर कोशिश करें।",
    kycSteps: "पहचान के चरण",
    kycSelfieIntro: "कैमरे की ओर देखें, चेहरा अंडाकार घेरे के अंदर रखें और दो बार पलकें झपकाएँ। फ़ोटो अपने-आप ली जाएगी।",
    kycLiveNote: "पलक-जाँच केवल इसी फ़ोन पर होती है। कोई वीडियो रिकॉर्ड या भेजा नहीं जाता — सिर्फ़ अंतिम फ़ोटो।",
    kycStart: "कैमरा शुरू करें",
    kycStarting: "कैमरा तैयार हो रहा है…",
    kycFaceNone: "अपना चेहरा घेरे के अंदर लाएँ",
    kycFaceMany: "कृपया सिर्फ़ आपका चेहरा",
    kycFaceFar: "थोड़ा पास आएँ",
    kycFaceNear: "थोड़ा पीछे हटें",
    kycFaceCenter: "चेहरा घेरे के बीच में रखें",
    kycBlink: "अब धीरे से दो बार पलकें झपकाएँ",
    kycBlinkOnce: "बढ़िया — एक बार और",
    kycHold: "स्थिर रहें…",
    kycTimeout: "दो साफ़ पलकें नहीं दिखीं। रोशनी की ओर मुँह करें, फ़ोन आँखों की ऊँचाई पर रखें और धीरे से पलकें झपकाएँ।",
    kycTryAgain: "फिर से कोशिश करें",
    kycSkipCheck: "पलक-जाँच के बिना सेल्फ़ी लें",
    kycManual: "चेहरा घेरे में रखें और बटन दबाएँ।",
    kycCamDenied: "कैमरा की अनुमति बंद है। ब्राउज़र सेटिंग में इस साइट के लिए कैमरा चालू करें — या फ़ोटो लें।",
    kycCamNone: "इस ब्राउज़र में लाइव कैमरा उपलब्ध नहीं है। फ़ोटो लें, या यह लिंक Chrome या Safari में खोलें।",
    kycTakePhoto: "फ़ोटो लें",
    kycUseThis: "यह फ़ोटो इस्तेमाल करें",
    kycLiveOk: "पलक-जाँच पास",
    kycCardTip: "अपना PAN या आधार मेज़ पर सीधा रखें, अच्छी रोशनी में, बिना चमक के। पूरा कार्ड फ़्रेम के अंदर रखें।",
    kycOpenCamera: "कैमरा खोलें",
    kycGallery: "गैलरी से चुनें",
    kycCardFit: "कार्ड को फ़्रेम के अंदर रखें",
    kycCardHint: "PAN या आधार — चारों कोने दिखें",
    kycBlurry: "यह फ़ोटो धुंधली लग रही है। फ़ोन स्थिर रखकर फिर से लें।",
    kycDark: "यह फ़ोटो बहुत अँधेरी है। अच्छी रोशनी में जाकर फिर से लें।",
    kycGlare: "कार्ड पर चमक है। उसे रोशनी से थोड़ा तिरछा करके फिर से लें।",
    kycLooksGood: "साफ़ और पढ़ने योग्य।",
    kycUseAnyway: "पढ़ी जा सकती है — फिर भी इस्तेमाल करें",
    kycAllDone: "दोनों फ़ोटो अपलोड हो गईं।",
    kycRedo: "फिर से लें",
  },
};

const gu: ContractLang = {
  title: "વપરાશકર્તા કરાર, જોખમ ડિસ્ક્લોઝર અને ડેટા સંમતિ",
  org: { name: "MNHA FINANCIALS", tagline: "તમારું ખાતું, સ્પષ્ટ નજરે.", meta: `કરાર આવૃત્તિ ${AGREEMENT_VERSION}` },
  intro:
    "આ તમારા અને MNHA Financials વચ્ચેનો કરાર છે. એમાં આ સેવા શું છે, ટ્રેડિંગનાં જોખમો શું છે, અને અમે તમારો વ્યક્તિગત ડેટા કેવી રીતે સંભાળીએ છીએ એ જણાવ્યું છે. એને English, हिन्दी કે ગુજરાતીમાં પૂરો વાંચો — અથવા સાંભળો — પછી છેલ્લે અલગ-અલગ સંમતિઓ આપો અને સહી કરો. તમે દરેક આવૃત્તિ એક વાર સ્વીકારો છો. તમે સમજો એ ભાષા પસંદ કરો, પછી સંમતિ આપો. અંગ્રેજી લખાણ સંદર્ભ આવૃત્તિ છે.",
  sections: [
    { heading: "1. અમે કોણ છીએ", body: "MNHA Financials (“MNHA”, “અમે”) mnhafinancials.com પર સૉફ્ટવેર પૂરું પાડે છે અને આ કરાર હેઠળ તમારા વ્યક્તિગત ડેટા માટે જવાબદાર છે (ડેટા ફિડ્યુશિયરી). સંપર્ક અને ફરિયાદ: support@mnhafinancials.com. MNHA સ્વતંત્ર છે અને Groww સાથે સંકળાયેલ, પ્રાયોજિત કે સમર્થિત નથી." },
    { heading: "2. MNHA શું છે — અને શું નથી", body: "MNHA સૉફ્ટવેર છે જે તમારા પોતાના Groww ખાતા સાથે જોડાય છે: એ તમને તમારું ખાતું બતાવે છે, MNHA ની ઓર્ડર ટિકિટ પર તમે મૂકેલા ઓર્ડર મોકલે છે, અને તમારા ખાતામાં કલમ 4 માં જણાવેલી ઓટોમેટિક ઇન્ટ્રાડે સ્ટ્રેટેજી ચલાવે છે. એ સ્ટોક બ્રોકર કે બેંક નથી, અને SEBI માં પોર્ટફોલિયો મેનેજર, રિસર્ચ એનાલિસ્ટ કે ઇન્વેસ્ટમેન્ટ એડવાઇઝર તરીકે નોંધાયેલ નથી. એ તમારા કોઈ પૈસા કે સિક્યુરિટીઝ રાખતું નથી (શૂન્ય કસ્ટડી), અને તમે આપેલી API key થી પૈસા ઉપાડી શકાતા નથી. તમારું ટ્રેડિંગ ખાતું તમારા બ્રોકર પાસે જ રહે છે." },
    { heading: "3. કોઈ ટિપ નહીં, કોઈ ભલામણ નહીં", body: "MNHA ખરીદ-વેચાણની ટિપ, ભલામણ કે ઇન્વેસ્ટમેન્ટ સલાહ આપતું નથી. એ જે કંઈ બતાવે — કોઈ સ્ટ્રેટેજી, એની સ્થિતિ, બજારનું અવલોકન, વિશ્લેષણ કે જૂના આંકડા — એ કોઈ પણ સિક્યુરિટી ખરીદવા, વેચવા કે રાખવાની સૂચના કે ભલામણ નથી. કલમ 4 ની ઓટોમેટિક સ્ટ્રેટેજી અને કલમ 8 ના એડમિનના ઓર્ડર સિવાય, દરેક નિર્ણય — ટ્રેડ કરવો કે નહીં, શું, ક્યારે, કેટલું, કયા ભાવે અને ક્યારે બહાર નીકળવું — ફક્ત તમારો છે. તમારા ખાતાના દરેક ટ્રેડનું પરિણામ, સ્ટ્રેટેજીના ટ્રેડ સહિત, તમારું છે." },
    { heading: "4. ઓટોમેટિક સ્ટ્રેટેજી", body: "MNHA ભાગ લેતા જોડાયેલા Groww ખાતાઓમાં એક ઓટોમેટિક ઇન્ટ્રાડે સ્ટ્રેટેજી ચલાવે છે. કોઈ ખાતું ત્યારે ભાગ લે છે જ્યારે એની Groww key પર MNHA એ આપેલો સ્ટેટિક IP ઉમેરેલો હોય (જેથી MNHA ઓર્ડર મોકલી શકે), આ કરાર પર સહી થયેલી હોય, અને એમાં ઓછામાં ઓછી એક ટ્રેડ જેટલી રકમ ખાલી હોય — જે દિવસના પહેલા સ્ટ્રેટેજી-ઓર્ડરની થોડી પહેલાં (સામાન્ય રીતે 09:20 વાગ્યે) ચકાસાય છે. કોઈ ટ્રેડિંગ દિવસે સ્ટ્રેટેજી લગભગ 09:20 વાગ્યે કોઈ એક F&O સ્ટોક શોર્ટ વેચી શકે છે અને એ જ દિવસે પછી પાછો ખરીદી શકે છે — જ્યારે એ દિવસના F&O સ્ટોક્સની સરેરાશ 09:20 થી 0.5% વધે (દર 5 મિનિટના ક્લોઝ પર ચકાસાય છે), લગભગ 10:15 વાગ્યે, લગભગ 15:15 વાગ્યે, કે એ પહેલાં પણ, જો MNHA બજાર પર નજર ન રાખી શકે — અને લગભગ 10:15 વાગ્યે કોઈ એક સ્ટોક (કદાચ એ જ) ખરીદીને લગભગ 15:15 વાગ્યે વેચી શકે છે. આ બધું ઇન્ટ્રાડે (MIS) છે: રાત્રે કંઈ પણ રાખવામાં આવતું નથી. ભાગ લેતા દરેક ખાતામાં દરેક ટ્રેડનું રૂપિયામાં કદ એકસરખું હોય છે — ₹5,00,000, જ્યાં સુધી MNHA એ ન બદલે. આ ઓર્ડર તમને પહેલાં પૂછ્યા વગર, બીજા કોઈ પણ ઓર્ડરની જેમ તમારા ખાતામાંથી Groww ને જાય છે; દરેક ઓર્ડર સ્ટ્રેટેજીના નામે નોંધાય છે, અને તમને તરત તમારી MNHA નોટિફિકેશનમાં જણાવાય છે. સ્ટ્રેટેજી એના એવા ઓર્ડર પણ રદ કરે છે જે એક મિનિટમાં ભરાયા ન હોય, અને જે પોઝિશન એ બંધ કરે એના પર MNHA ના ઊભા ઓર્ડર પણ. સ્ટ્રેટેજીથી નુકસાન થઈ શકે છે, એક દિવસમાં પણ અને મહિનાઓમાં પણ; એના પેપર-ટ્રેડિંગ અને જૂના પરિણામો એ નથી બતાવતા કે એ આગળ શું કરશે. એનાથી થતો કોઈ પણ નફો કે નુકસાન સંપૂર્ણપણે તમારો છે, અને એના ટ્રેડ પર Groww ની બ્રોકરેજ અને ચાર્જ પણ. MNHA સ્ટ્રેટેજી ગમે ત્યારે બંધ કરી શકે છે: ત્યારે એ કંઈ નવું ખોલતી નથી, જ્યારે એ દિવસે પહેલેથી ખોલેલી પોઝિશન ઉપર જણાવ્યા મુજબ બંધ કરાય છે. તમારા ખાતાને એમાંથી બહાર રખાવવા support@mnhafinancials.com પર લખો. Settings માં Groww ડિસકનેક્ટ કરવાથી એ તરત અટકી જાય છે — પણ એણે પહેલેથી ખોલેલી પોઝિશન ત્યાં સુધી ખુલ્લી રહે છે જ્યાં સુધી તમે એને બંધ ન કરો, કે Groww બજાર બંધ થવાની નજીક એને સ્ક્વેર-ઑફ ન કરે." },
    { heading: "5. ટ્રેડિંગ જોખમી છે — કોઈ ગેરંટી નહીં", body: "ટ્રેડિંગ અને રોકાણમાં ખરું જોખમ છે, તમારી આખી મૂડી ડૂબી શકે છે; લીવરેજવાળાં પ્રોડક્ટમાં મૂકેલી રકમ કરતાં વધુ નુકસાન થઈ શકે છે. કોઈ ગેરંટીડ રિટર્ન, ગેરંટીડ નફો કે જોખમ-મુક્ત સ્ટ્રેટેજી નથી, અને ગેરંટીડ કે ઝીરો-લોસ રિટર્નનું કોઈ પણ વચન — કોઈનું પણ — ખોટું છે. બેકટેસ્ટ, સિમ્યુલેશન અને ભૂતકાળનાં પરિણામો ભવિષ્ય બતાવતાં નથી. SEBI ના પોતાના અભ્યાસમાં જણાયું કે ઇક્વિટી F&O માં લગભગ દસમાંથી નવ વ્યક્તિગત ટ્રેડરોને નુકસાન થયું. જે પૈસા ગુમાવવાનું તમને પરવડે નહીં એનાથી ટ્રેડ ન કરો." },
    { heading: "6. અમે કઈ માહિતી લઈએ છીએ", body: "ખાતું: તમારું ઈમેલ સરનામું (જેની ખાતરી અમે તમને ઈમેલ કરેલા એક વખતના કોડથી કરીએ છીએ) અને પાસવર્ડ (ફક્ત સૉલ્ટેડ હેશ તરીકે રખાય છે). આ પેજ પર ઓળખની ખરાઈ: એક સેલ્ફી અને તમારા PAN કે આધારનો ફોટો, અને એમાંની વિગતો — ફક્ત એ ચકાસવા માટે કે ખાતું ખોલનાર તમે જ છો, આ કરાર તમે જાતે પૂરો કર્યો એનો પુરાવો રાખવા માટે, અને ખાતાની સુરક્ષા માટે. તમે QR કોડ સ્કેન કરીને આ ફોટા તમારા ફોન પર લઈ શકો છો: એ લિંક 15 મિનિટ ચાલે છે અને તમારા ખાતામાં ફક્ત આ બે ફોટા અપલોડ કરી શકે છે. અપલોડ કરતાં જ એ રાખી લેવાય છે, સહી કરતાં પહેલાં પણ. જો તમે MNHA ની વૈકલ્પિક ખરાઈ પણ કરો, તો અમે તમારું પૂરું નામ, PAN, જન્મતારીખ, ટપાલ સરનામું, એક સેલ્ફી અને એક ID દસ્તાવેજ લઈએ છીએ, અને તમારી સાથે લાઇવ વીડિયો કૉલ કરી શકીએ છીએ; PAN અને જન્મતારીખ એન્ક્રિપ્ટેડ રખાય છે. ઓળખની તસવીરો અમારા સર્વર પર ફાઇલો તરીકે, જાહેર પહોંચથી બહાર રખાય છે. અમે આ બધાને સંવેદનશીલ ગણીએ છીએ." },
    { heading: "7. તમારું Groww ખાતું જોડવું", body: "Groww જોડવું એ અલગ પગલું છે. તમે Groww ની પોતાની વેબસાઇટ પર સાઇન ઇન કરો છો અને ત્યાં જ API key અને TOTP secret બનાવો છો; અમે તમારો Groww પાસવર્ડ, PIN કે OTP ક્યારેય માંગતા નથી, મેળવતા નથી કે જોતા નથી. અમે key ને Groww સાથે લાઇવ ચકાસીએ છીએ અને એને એન્ક્રિપ્ટેડ (AES-256) રાખીએ છીએ. એનાથી MNHA તમારો Groww ક્લાયન્ટ કોડ અને ચાલુ સેગમેન્ટ, બેલેન્સ, હોલ્ડિંગ્સ, પોઝિશન, ઓર્ડર બુક અને ફિલ, અને તમારા ડેસ્ક પર દેખાતા લાઇવ ભાવ અને ઓપ્શન ચેઇન વાંચે છે — જેથી તમારું ડેસ્ક બતાવી શકે અને તમારા ખરા ફિલ પરથી રાઉન્ડ-ટ્રિપ વિશ્લેષણ કરી શકે — અને કલમ 4 અને 8 માં જણાવેલા ઓર્ડર મોકલે છે. MNHA તમને જે સ્ટેટિક IP આપે એ તમારી key પર ઉમેરવો વૈકલ્પિક છે, પણ Groww પોતાના API થી મોકલાયેલા ઓર્ડર ફક્ત key પર નોંધાયેલા સ્ટેટિક IP પરથી જ સ્વીકારે છે: એના વગર MNHA તમારા ખાતામાં કોઈ પણ ઓર્ડર મોકલી શકતું નથી — ન તમારો, ન ઓટોમેટિક સ્ટ્રેટેજીનો, ન એડમિનનો — અને તમારું ખાતું સ્ટ્રેટેજીમાં ભાગ લેતું નથી." },
    { heading: "8. ઓર્ડર, અને MNHA ના એડમિનની મદદ", body: "તમારી key પર એ સ્ટેટિક IP ઉમેરાઈ જાય પછી, તમે MNHA ની ઓર્ડર ટિકિટ પરથી તમારા પોતાના Groww ખાતામાં ઓર્ડર મૂકી શકો છો. તમે મૂકેલો દરેક ઓર્ડર તમારી પુષ્ટિ પછી જ મોકલાય છે, અને ફક્ત એક જ વાર — એ આપમેળે ક્યારેય ફરી મોકલાતો નથી. MNHA દરેક ઓર્ડરને પહેલાં ચકાસે છે અને પોતાની મર્યાદાઓ (જેમ કે મહત્તમ જથ્થો) તોડતો ઓર્ડર નકારે છે; જે ઓર્ડર આ ચકાસણીમાં પાસ થાય, એને પણ Groww કે એક્સચેન્જ નકારી શકે છે. MNHA પોતાના દ્વારા મોકલાયેલા દરેક ઓર્ડરનો રેકોર્ડ રાખે છે: શું મોકલાયું, ક્યારે, કોણે, એનું પરિણામ અને Groww નો ઓર્ડર ID. મદદ માટે, MNHA નો એડમિન એક વખતમાં વધુમાં વધુ એક કલાક માટે તમારું ખાતું ખોલી શકે છે અને તમે જે જુઓ છો એ જોઈ શકે છે; એડમિન દરેક વખતે તમારું ખાતું ખોલે એ સમય અને એડમિનના IP સાથે લૉગ થાય છે. એડમિન Groww જોડવામાં તમારી મદદ કરી શકે છે — એ પણ લૉગ થાય છે — પરંતુ તમારા વતી આ કરાર પર સહી કરી શકતો નથી, તમારી સંમતિઓ કે પાસવર્ડ બદલી શકતો નથી, અને તમારા ઓળખના ફોટા લઈ શકતો નથી. એડમિન તમારા ખાતામાં ઓર્ડર મૂકી કે રદ પણ કરી શકે છે, અને MNHA ના કન્સોલ પરથી એક જ ઓર્ડર ઘણા ખાતાઓમાં એકસાથે મોકલી શકે છે કે એમાં ખુલ્લી પોઝિશન બંધ કરી શકે છે (જેમ કે સ્ટ્રેટેજીની પોઝિશન): દરેક ઓર્ડર બીજા કોઈ પણ ઓર્ડરની જેમ Groww ને જાય છે, એડમિનના નામે નોંધાય છે, અને તમને તરત તમારી MNHA નોટિફિકેશનમાં જણાવાય છે." },
    { heading: "9. અમે તમારી માહિતી શા માટે વાપરીએ છીએ", body: "ફક્ત આ કરારમાં જણાવેલા હેતુઓ માટે: તમારું ખાતું બનાવવું, સુરક્ષિત રાખવું અને ચલાવવું; તમને સાઇન ઇન કરાવવા; તમારી ઓળખ ચકાસવી અને તમારી સ્વીકૃતિ નોંધવી; તમારા કહેવાથી Groww જોડવું અને માન્ય માહિતી વાંચવી; તમે મૂકેલા ઓર્ડર, ઓટોમેટિક સ્ટ્રેટેજીના ઓર્ડર (કલમ 4) અને એડમિનના ઓર્ડર (કલમ 8) મોકલવા અને એનો રેકોર્ડ રાખવો; તમારું ડેસ્ક અને વિશ્લેષણ બતાવવું; તમે માંગો ત્યારે મદદ કરવી; સેવાને સુરક્ષિત રાખવી; કાનૂની જવાબદારીઓ પૂરી કરવી; અને તમારી વિનંતીઓ અને ફરિયાદો સંભાળવી." },
    { heading: "10. તમારો ડેટા ક્યાં રખાય છે અને કોણ પ્રોસેસ કરે છે", body: "તમારો ડેટા અમારા સર્વર પર રખાય છે, જે અમારો હોસ્ટિંગ પ્રદાતા (Hostinger) અમેરિકામાં ચલાવે છે, એટલે એની પ્રોસેસિંગ ભારતની બહાર થાય છે. તમે જે ખાતા-ડેટા વાંચવાનું કહો છો એ Groww આપે છે, અને તમારા ખાતામાંથી મોકલાયેલા ઓર્ડર Groww મેળવે છે; જાહેર બજાર-ડેટા બીજા બજાર-ડેટા સ્ત્રોતોમાંથી પણ આવે છે, અને એમને કોઈ વ્યક્તિગત ડેટા મોકલાતો નથી. ખાતાને લગતા ઈમેલ, જેમ કે સાઇન-અપ કોડ, Google ની Gmail સેવા દ્વારા મોકલાય છે, જેને તમારું ઈમેલ સરનામું અને સંદેશ મળે છે. જો લાઇવ ખરાઈ કૉલ નક્કી થાય, તો એ આમંત્રણમાં જણાવેલી વીડિયો-મીટિંગ સેવા પર થાય છે, અને MNHA એને રેકોર્ડ કરતું નથી. જો રેકોર્ડ કરેલા ઓડિયોની સુવિધા ચાલુ હોય, તો ઓડિયો બનાવવા માટે ફક્ત આ કરારનું લખાણ Microsoft Azure ને મોકલાય છે. આજે અમે કોઈ થર્ડ-પાર્ટી એનાલિટિક્સ, જાહેરાત કે ઈમેલ-માર્કેટિંગ સેવા વાપરતા નથી, અને અમે તમારો વ્યક્તિગત ડેટા વેચતા નથી." },
    { heading: "11. અમે એ કેટલો સમય રાખીએ છીએ", body: "તમારા ખાતાની વિગતો, ઓળખ સામગ્રી (સેલ્ફી, ID ફોટો) અને ખરાઈ વિગતો: તમે તમારું ખાતું ડિલીટ ન કરો ત્યાં સુધી. તમારી Groww key અને ક્લાયન્ટ કોડ: તમે Groww ડિસ્કનેક્ટ ન કરો કે ખાતું ડિલીટ ન કરો — બેમાંથી જે પહેલું થાય ત્યાં સુધી. MNHA દ્વારા મોકલાયેલા ઓર્ડરનો રેકોર્ડ (કલમ 4 અને 8): એની છેલ્લી 5,000 નોંધો, તમે ખાતું ડિલીટ ન કરો ત્યાં સુધી. તમારા Groww ખાતાનો બાકીનો ડેટા રખાતો નથી — દરેક વખતે પેજ ખોલો ત્યારે લાઇવ વંચાય છે. તમારા સંમતિ રેકોર્ડ અને નોટિફિકેશન: તમે ખાતું ડિલીટ ન કરો ત્યાં સુધી. મેમ્બરશિપ ઇનવૉઇસ, જો કોઈ હોય તો: ખાતું ડિલીટ કર્યા પછી પણ બિલિંગ રેકોર્ડ તરીકે રખાય છે, ફક્ત હિસાબ અને કાનૂની હેતુઓ માટે. સુરક્ષા અને સમસ્યા-નિવારણ માટેના સર્વર લૉગ આપમેળે રોટેટ થઈને દૂર થાય છે." },
    { heading: "12. તમારા અધિકારો અને વિકલ્પો", body: "તમે પૂછી શકો કે અમે તમારો કયો વ્યક્તિગત ડેટા કેવી રીતે પ્રોસેસ કરીએ છીએ; એ જોઈ શકો; એ સુધારી કે અપડેટ કરી શકો; જરૂર ન રહે ત્યારે એ ભૂંસાવી શકો; કોઈ સંમતિ પાછી ખેંચી શકો; અને ફરિયાદ કરી શકો. સંમતિ પાછી ખેંચવાથી એ પહેલાં થયેલી કાયદેસર પ્રોસેસિંગ અમાન્ય થતી નથી, અને કોઈ જરૂરી સંમતિ પાછી ખેંચવાથી એવું બને કે અમે સેવાનો એ ભાગ ચાલુ ન રાખી શકીએ." },
    { heading: "13. સંમતિ પાછી ખેંચવી, ડિસ્કનેક્ટ કરવું અને ખાતું ડિલીટ કરવું", body: "Settings → “Privacy & consents” (પ્રાઇવસી અને સંમતિઓ) માં તમે વૈકલ્પિક સંમતિઓ ગમે ત્યારે બંધ કરી શકો — જેટલી સરળતાથી આપી હતી એટલી જ સરળતાથી. Settings → “Disconnect broker” (બ્રોકર ડિસ્કનેક્ટ કરો) થી તમારી Groww key તરત દૂર થાય છે અને તમારી Groww સંમતિ પાછી ખેંચાયાની નોંધ થાય છે; તમે Groww પર પણ key રદ કરી શકો છો. Settings → “Delete account” (ખાતું ડિલીટ કરો) થી તમારું ખાતું અને વ્યક્તિગત ડેટા તરત ભૂંસાઈ જાય છે — બિલિંગ રેકોર્ડ અને સર્વર લૉગ સિવાય બધું, અમારા સૉફ્ટવેરની બેકઅપ નકલો સહિત (પહેલાં ચાલુ મેમ્બરશિપ છોડવી પડશે અને બાકી ઇનવૉઇસ ચૂકવવું પડશે; અને કોઈ ટ્રેડિંગ દિવસે, MNHA ની ઓટોમેટિક સ્ટ્રેટેજી કે એડમિનની એ દિવસે તમારા ખાતામાં ખુલ્લી કોઈ પણ પોઝિશન કે ઓર્ડર પહેલાં બંધ થવો જોઈએ — 15:35 IST પછી ખાતું ફરી ડિલીટ કરી શકાય છે). આ આવૃત્તિ પર સહી કરતાં કે Groww જોડતાં પહેલાં પણ Settings તમારા માટે ખુલ્લું રહે છે. તમે support@mnhafinancials.com પર પણ લખી શકો છો." },
    { heading: "14. માર્કેટિંગ, એનાલિટિક્સ અને કુકીઝ", body: "માર્કેટિંગ મેસેજ (ઈમેલ, SMS કે WhatsApp) અને બિન-જરૂરી એનાલિટિક્સ કે કુકીઝ વૈકલ્પિક અને અલગ છે, અને ફક્ત સંમતિ આપનાર માટે છે; એ નકારવાથી કે પાછી ખેંચવાથી મૂળ સેવા ક્યારેય મર્યાદિત થતી નથી. આજે અમે કોઈ માર્કેટિંગ મોકલતા નથી અને કોઈ એનાલિટિક્સ ટૂલ કે બિન-જરૂરી કુકી વાપરતા નથી — ફક્ત એક અનિવાર્ય સાઇન-ઇન કુકી (આઠ કલાક માટે માન્ય) અને તમારા બ્રાઉઝરમાં રખાયેલી થીમ સેટિંગ." },
    { heading: "15. તમારી સંમતિનો રેકોર્ડ", body: "અમે તમારી સંમતિનો પુરાવો રાખીએ છીએ: કરારની આવૃત્તિ અને એની ફિંગરપ્રિન્ટ, તમે જોયેલી દરેક ભાષા, તમે ટિક કરેલું દરેક બોક્સ, તમારી ટાઇપ કરેલી સહી, તારીખ અને સમય, તમારું IP સરનામું અને ડિવાઇસ, તમારી સેલ્ફી અને ID ફોટો, અને પછીનો કોઈ પણ ફેરફાર કે પાછી ખેંચેલી સંમતિ." },
    { heading: "16. સેવા, જવાબદારી, ફેરફાર અને કાયદો", body: "સેવા “જેમ છે તેમ”, વોરંટી વગર, કાયદો મંજૂરી આપે ત્યાં સુધી આપવામાં આવે છે; એમાં વિલંબ, વિક્ષેપ કે ખોટો ડેટા હોઈ શકે, એટલે મહત્ત્વની વાત હંમેશા તમારા બ્રોકર પર ચકાસો. MNHA ટ્રેડિંગ નુકસાન, ડાઉનટાઇમ કે ડેટા ભૂલ માટે જવાબદાર નથી. અમે આ કરાર બદલી શકીએ; મોટો ફેરફાર થાય ત્યારે અમે MNHA માં તમને જણાવીશું અને નવી આવૃત્તિ જોઈને સહી કરવાનું કહીશું. આ ભારતના કાયદાને આધીન છે, જેમાં ડિજિટલ પર્સનલ ડેટા પ્રોટેક્શન એક્ટ, 2023 અને એના નિયમો સામેલ છે." },
    { heading: "17. પ્રશ્નો અને ફરિયાદો", body: "પ્રશ્નો, ડેટા વિનંતી કે ફરિયાદ માટે support@mnhafinancials.com પર લખો. અમે થોડા કામકાજના દિવસોમાં જવાબ આપવાનો પ્રયત્ન કરીએ છીએ. જ્યાં ડિજિટલ પર્સનલ ડેટા પ્રોટેક્શન એક્ટ લાગુ પડે, ત્યાં તમે ડેટા પ્રિન્સિપલને મળતા ઉપાયો પણ લઈ શકો છો, જેમાં ભારતના ડેટા પ્રોટેક્શન બોર્ડમાં ફરિયાદનો સમાવેશ થાય છે." },
  ],
  consents: [
    { key: "account", label: "ખાતું, શરતો અને પ્રાઇવસી", text: "હું MNHA Financials ખાતું બનાવવા અને આ કરાર — ઉપયોગની શરતો, પ્રાઇવસી પોલિસી અને જોખમ ડિસ્ક્લોઝર સહિત — સ્વીકારવા સંમત છું. હું સમજું છું કે મારો વ્યક્તિગત ડેટા ઉપર જણાવ્યા મુજબ પ્રોસેસ થશે." },
    { key: "identity", label: "ઓળખની ખરાઈ", text: "હું મારી ઓળખ ચકાસવા અને મારા ખાતાની સુરક્ષા માટે MNHA ને મારી સેલ્ફી અને ફોટો ID લેવા અને રાખવાની સંમતિ આપું છું, ઉપર જણાવ્યા મુજબ." },
    { key: "groww", label: "Groww કનેક્શન અને ઓર્ડર", text: "હું સંમતિ આપું છું કે MNHA મારી Groww API key અને TOTP secret એન્ક્રિપ્ટેડ રાખે અને એનાથી મારો Groww ક્લાયન્ટ કોડ, બેલેન્સ, હોલ્ડિંગ્સ, પોઝિશન, ઓર્ડર બુક, ફિલ અને લાઇવ બજાર-ડેટા વાંચે, જેથી મારું ડેસ્ક અને રાઉન્ડ-ટ્રિપ વિશ્લેષણ ચાલી શકે, અને Groww ને એ ઓર્ડર મોકલે જેની હું MNHA ની ઓર્ડર ટિકિટ પર પુષ્ટિ કરું, કલમ 4 માં જણાવેલી MNHA ની ઓટોમેટિક સ્ટ્રેટેજીના ઓર્ડર અને રદ કરવાની વિનંતીઓ, તેમ જ એ ઓર્ડર, રદ કરવાની વિનંતીઓ અને પોઝિશનમાંથી બહાર નીકળવાના ઓર્ડર પણ, જે MNHA નો એડમિન મારા ખાતામાં કરે." },
    { key: "risk", label: "સ્થિતિ અને જોખમ", text: "હું સમજું છું કે MNHA બ્રોકર નથી અને પોર્ટફોલિયો મેનેજર, રિસર્ચ એનાલિસ્ટ કે ઇન્વેસ્ટમેન્ટ એડવાઇઝર તરીકે નોંધાયેલ નથી, મને કોઈ સિક્યુરિટી ખરીદવા કે વેચવાની ભલામણ કરતું નથી, એની ઓટોમેટિક સ્ટ્રેટેજી કલમ 4 મુજબ મારા ખાતામાં ટ્રેડ કરે છે અને એનો નફો-નુકસાન મારો છે, અને ટ્રેડિંગથી મોટું નુકસાન થઈ શકે છે." },
    { key: "marketing", label: "માર્કેટિંગ", text: "હું ઈમેલ, SMS અને/અથવા WhatsApp દ્વારા MNHA ના વૈકલ્પિક માર્કેટિંગ મેસેજ મેળવવા સંમત છું. હું એ ગમે ત્યારે પાછી ખેંચી શકું છું, મૂળ સેવા ગુમાવ્યા વગર." },
    { key: "analytics", label: "એનાલિટિક્સ અને કુકીઝ", text: "હું વૈકલ્પિક એનાલિટિક્સ અને બિન-જરૂરી કુકીઝ માટે સંમત છું, જેથી MNHA સમજી શકે કે એની વેબસાઇટ અને સૉફ્ટવેર કેવી રીતે વપરાય છે. હું એ ગમે ત્યારે પાછી ખેંચી શકું છું, જરૂરી સુવિધાઓ ગુમાવ્યા વગર." },
  ],
  spokenAck:
    "હું આ મારી પોતાની મરજીથી સહી કરું છું. હું સમજું છું કે MNHA Financials મને ખરીદ-વેચાણની કોઈ ટિપ આપતું નથી, કે એની ઓટોમેટિક ઇન્ટ્રાડે સ્ટ્રેટેજી આ કરાર મુજબ મારા ખાતામાં ટ્રેડ કરે છે અને એનો નફો-નુકસાન મારો છે, કે ટ્રેડિંગનો બીજો દરેક નિર્ણય મારી પોતાની જવાબદારી છે, કે ટ્રેડિંગ જોખમી છે અને મારા પૈસા ડૂબી શકે છે, અને કોઈ ગેરંટીડ રિટર્ન નથી. મેં આ કરાર વાંચ્યો અને સમજ્યો છે.",
  ui: {
    timeDone: "વાંચવાનો સમય પૂરો",
    uploading: "અપલોડ થાય છે…",
    uploadFailed: "અપલોડ ન થયું — કૃપા કરી ફરી પ્રયત્ન કરો.",
    fileTooBig: "આ ફોટો 10 MB કરતાં મોટો છે — કૃપા કરી નાના કદમાં ફરી લો.",
    signName: "સહી કરવા માટે તમારું પૂરું નામ લખો.",
    mediaStale: "આ સહી માટે કૃપા કરી તમારી સેલ્ફી અને ID ફોટો ફરી ઉમેરો.",
    before: "શરૂ કરતાં પહેલાં",
    subtitle: "આખો કરાર વાંચો કે સાંભળો, ફોન પર તમારી ઓળખ ચકાસો, સંમતિઓ આપો અને સહી કરો.",
    language: "ભાષા", listen: "સાંભળો", pause: "થોભો", playing: "વાંચી રહ્યું છે…", loadingAudio: "ઓડિયો તૈયાર થાય છે…",
    noVoice: "આ બ્રાઉઝરમાં આ ભાષાનો અવાજ નથી. આ પેજ Microsoft Edge માં, અથવા Android પર Chrome માં ખોલો — અથવા ઉપરનું લખાણ વાંચો.",
    readToEnd: "આગળ વધવા માટે છેક સુધી સ્ક્રોલ કરો",
    jumpToEnd: "છેક સુધી જાઓ",
    needRead: "આ ટિક કરતાં પહેલાં કરાર છેક સુધી સ્ક્રોલ કરો.",
    retake: "ફોટા ફરી લો",
    retaking: "કાઢી રહ્યા છીએ…",
    retakeHint: "લીધેલા ફોટા કાઢીને નવો QR કોડ આપે છે.",
    readDone: "છેક સુધી વાંચ્યું", listenDone: "કરાર સાંભળ્યો",
    timeLeft: "કૃપા કરી એક ક્ષણ થોભો", endOfAgreement: "— કરાર સમાપ્ત —",
    identity: "તમારી ઓળખ ચકાસો", selfie: "સેલ્ફી", idphoto: "PAN / આધાર ફોટો",
    consentsTitle: "તમારી સંમતિઓ",
    consentsHint: "દરેક એક અલગથી ટિક કરો. ચાર જરૂરી સંમતિઓ MNHA વાપરવા માટે જોઈએ; વૈકલ્પિક ક્યારેય નહીં.",
    required: "જરૂરી", optional: "વૈકલ્પિક", needRequired: "કૃપા કરી ચારેય જરૂરી સંમતિઓ ટિક કરો.",
    signature: "ડિજિટલ સહી — તમારું પૂરું નામ લખો", signaturePh: "તમારું પૂરું નામ",
    submit: "સંમતિ આપો અને સહી કરો", submitting: "તમારી સંમતિ નોંધાઈ રહી છે…",
    auditNote: "સહી કરવાથી તમારું નામ, કરાર આવૃત્તિ, પસંદ કરેલી ભાષા, તમે ટિક કરેલું દરેક બોક્સ, અને તારીખ, સમય, IP અને ડિવાઇસ નોંધાય છે. ટાઇમર અને ઓડિયો સહાયક છે, કાનૂની ગેરંટી નથી.",
    needMedia: "કૃપા કરી પહેલાં તમારી સેલ્ફી અને PAN/આધાર ફોટો ઉમેરો.",
    identityWait: "વાંચવાનો સમય પૂરો થતાં અહીં એક QR કોડ આવશે — તમારી સેલ્ફી અને ID ફોટો લેવા માટે એને તમારા ફોનથી સ્કેન કરો.",
    scanTitle: "તમારા ફોન પર આગળ વધો",
    scanHint: "આ QR કોડ તમારા ફોનના કૅમેરાથી સ્કેન કરો, પછી ત્યાં એક સેલ્ફી અને તમારા PAN કે આધારનો ફોટો લો. આ પેજ આપમેળે અપડેટ થઈ જશે.",
    scanExpires: "લિંક 15 મિનિટ ચાલે છે અને ફક્ત આ બે ફોટા અપલોડ કરી શકે છે.",
    scanRefresh: "નવો QR કોડ",
    scanFailed: "QR કોડ ન બન્યો. ફરી પ્રયત્ન કરો, અથવા આ જ કમ્પ્યુટરથી અપલોડ કરો.",
    waitingPhone: "તમારા ફોનની રાહ જોવાય છે…",
    useComputer: "ફોન નથી? આ જ કમ્પ્યુટરથી અપલોડ કરો",
    declaration: "સહી કરીને તમે ખાતરી આપો છો:",
    phoneTitle: "તમારી ઓળખ ચકાસો",
    phoneFor: "MNHA ખાતા માટે",
    phoneSelfie: "સેલ્ફી લો",
    phoneSelfieHint: "સારા પ્રકાશમાં કૅમેરા સામે જુઓ.",
    phoneId: "તમારા PAN કે આધારનો ફોટો",
    phoneIdHint: "આખું કાર્ડ, સીધું અને વાંચી શકાય એવું.",
    phoneTake: "કૅમેરા ખોલો",
    phoneRetake: "ફરી લો",
    phoneDone: "થઈ ગયું. પૂરું કરવા તમારા કમ્પ્યુટર પર પાછા જાઓ.",
    phoneExpired: "આ લિંકની મુદત પૂરી થઈ ગઈ છે. તમારા કમ્પ્યુટર પર નવો QR કોડ બનાવો.",
    phoneFailed: "અપલોડ ન થયું — કૃપા કરી ફરી પ્રયત્ન કરો.",
    kycSteps: "ઓળખનાં પગલાં",
    kycSelfieIntro: "કૅમેરા સામે જુઓ, ચહેરો અંડાકાર ગોળાની અંદર રાખો અને બે વાર આંખ પલકાવો. ફોટો આપમેળે લેવાશે.",
    kycLiveNote: "આંખ-પલકની ચકાસણી ફક્ત આ ફોન પર જ થાય છે. કોઈ વીડિયો રેકોર્ડ કે મોકલાતો નથી — ફક્ત છેલ્લો ફોટો.",
    kycStart: "કૅમેરા શરૂ કરો",
    kycStarting: "કૅમેરા તૈયાર થાય છે…",
    kycFaceNone: "તમારો ચહેરો ગોળાની અંદર લાવો",
    kycFaceMany: "કૃપા કરી ફક્ત તમારો ચહેરો",
    kycFaceFar: "થોડા નજીક આવો",
    kycFaceNear: "થોડા પાછળ જાઓ",
    kycFaceCenter: "ચહેરો ગોળાની વચ્ચે રાખો",
    kycBlink: "હવે ધીમેથી બે વાર આંખ પલકાવો",
    kycBlinkOnce: "સરસ — હજી એક વાર",
    kycHold: "સ્થિર રહો…",
    kycTimeout: "બે સ્પષ્ટ પલકારા દેખાયા નહીં. પ્રકાશ તરફ મોં રાખો, ફોન આંખની ઊંચાઈએ રાખો અને ધીમેથી પલકાવો.",
    kycTryAgain: "ફરી પ્રયત્ન કરો",
    kycSkipCheck: "આંખ-પલકની ચકાસણી વગર સેલ્ફી લો",
    kycManual: "ચહેરો ગોળામાં રાખો અને બટન દબાવો.",
    kycCamDenied: "કૅમેરાની પરવાનગી બંધ છે. બ્રાઉઝરના સેટિંગમાં આ સાઇટ માટે કૅમેરા ચાલુ કરો — અથવા ફોટો લો.",
    kycCamNone: "આ બ્રાઉઝરમાં લાઇવ કૅમેરા ઉપલબ્ધ નથી. ફોટો લો, અથવા આ લિંક Chrome કે Safariમાં ખોલો.",
    kycTakePhoto: "ફોટો લો",
    kycUseThis: "આ ફોટો વાપરો",
    kycLiveOk: "આંખ-પલકની ચકાસણી પાસ",
    kycCardTip: "તમારું PAN કે આધાર ટેબલ પર સીધું રાખો, સારા પ્રકાશમાં, ચમક વગર. આખું કાર્ડ ફ્રેમની અંદર રાખો.",
    kycOpenCamera: "કૅમેરા ખોલો",
    kycGallery: "ગૅલેરીમાંથી પસંદ કરો",
    kycCardFit: "કાર્ડ ફ્રેમની અંદર રાખો",
    kycCardHint: "PAN કે આધાર — ચારેય ખૂણા દેખાવા જોઈએ",
    kycBlurry: "આ ફોટો ઝાંખો લાગે છે. ફોન સ્થિર રાખીને ફરી લો.",
    kycDark: "આ ફોટો બહુ અંધારો છે. સારા પ્રકાશમાં જઈને ફરી લો.",
    kycGlare: "કાર્ડ પર ચમક છે. તેને પ્રકાશથી થોડું ત્રાંસું કરીને ફરી લો.",
    kycLooksGood: "સ્પષ્ટ અને વાંચી શકાય એવો.",
    kycUseAnyway: "વાંચી શકાય છે — છતાં વાપરો",
    kycAllDone: "બંને ફોટા અપલોડ થઈ ગયા.",
    kycRedo: "ફરી લો",
  },
};

export const CONTRACT: Record<Lang, ContractLang> = { en, hi, gu };

/** Everything that is read aloud, in order — one string per natural pause. */
export function spokenParts(lang: Lang): string[] {
  const c = CONTRACT[lang];
  return [
    `${c.title}.`,
    c.intro,
    ...c.sections.map((s) => `${s.heading}. ${s.body}`),
    ...c.consents.map((k) => `${k.label}. ${k.text}`),
    c.spokenAck,
  ];
}

/** Canonical (English) plaintext — what gets hashed. */
export function agreementPlainText(): string {
  return (
    `${en.org.name} — ${en.title}\nVersion ${AGREEMENT_VERSION}\n\n${en.intro}\n\n` +
    en.sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n") +
    `\n\nConsents:\n` +
    en.consents
      .map((k) => `[${CONSENT_KEYS.find((c) => c.key === k.key)?.required ? "required" : "optional"}] ${k.label}: ${k.text}`)
      .join("\n") +
    `\n\nAcknowledgement: ${en.spokenAck}`
  );
}
export function agreementHash(): string {
  return createHash("sha256").update(agreementPlainText()).digest("hex");
}

/* ------------------------------------------------------------ store */

export interface ConsentRecord {
  userId: string;
  signatureName: string;
  language: Lang;
  agreementVersion: string;
  agreementHash: string;
  consentedAt: number;
  ip: string;
  userAgent: string;
  /** `liveness`: the selfie was taken through the on-phone blink check (agreement 3.3+). */
  media: { selfie: boolean; idPhoto: boolean; video: boolean; liveness?: boolean };
  /** Each separate consent exactly as ticked at signing (agreement v3+). Never changed. */
  consents?: Record<ConsentKey, boolean>;
  /** The consents in force now: the signed set plus later changes. */
  current?: Record<ConsentKey, boolean>;
  /** Every later change — optional consents switched off/on, Groww disconnected/reconnected. */
  changes?: { at: number; key: ConsentKey; value: boolean }[];
  /** Every agreement language the user opened before signing. */
  languagesViewed?: Lang[];
}

interface Store { records: ConsentRecord[] }

const FILE = process.env.CONSENT_FILE ?? path.join(process.cwd(), "data", "consents.json");

const g = globalThis as { __mnhaConsent?: { queue: Promise<unknown> } };
g.__mnhaConsent ??= { queue: Promise.resolve() };
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaConsent!.queue.then(job, job);
  g.__mnhaConsent!.queue = run.catch(() => undefined);
  return run;
}
async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    return Array.isArray(parsed.records) ? parsed : { records: [] };
  } catch { return { records: [] }; }
}

/** For erasure: a read that fails loudly (only a missing file is "empty"), so
 *  a corrupt store can never be reported as successfully erased. */
async function readStrict(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { records: [] };
    throw e;
  }
  const parsed = JSON.parse(raw) as Store;
  if (!Array.isArray(parsed.records)) throw new Error("consents: malformed store");
  return parsed;
}
/** `scrubBackup`: on erasure, overwrite the .bak too, so deleted data does not linger in the backup. */
async function write(store: Store, scrubBackup = false): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try { await copyFile(FILE, `${FILE}.bak`); } catch { /* first write */ }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
  if (scrubBackup) await copyFile(FILE, `${FILE}.bak`);
}

export async function recordConsent(
  userId: string,
  input: {
    signatureName: string;
    language: Lang;
    ip: string;
    userAgent: string;
    media: { selfie: boolean; idPhoto: boolean; video: boolean; liveness?: boolean };
    consents: Record<ConsentKey, boolean>;
    languagesViewed: Lang[];
  },
): Promise<void> {
  return enqueue(async () => {
    // Strict: a store that cannot be read must never be overwritten as empty.
    const store = await readStrict();
    store.records.push({
      userId,
      signatureName: input.signatureName.trim().slice(0, 120),
      language: input.language,
      agreementVersion: AGREEMENT_VERSION,
      agreementHash: agreementHash(),
      consentedAt: Date.now(),
      ip: input.ip.slice(0, 64),
      userAgent: input.userAgent.slice(0, 300),
      media: input.media,
      consents: { ...input.consents },
      current: { ...input.consents },
      changes: [],
      languagesViewed: input.languagesViewed,
    });
    await write(store);
  });
}

/** The user's consent record in force — the latest one on the current agreement
 *  version or on an earlier version that is still accepted — if any. */
export async function currentConsent(userId: string): Promise<ConsentRecord | null> {
  const mine = (await read()).records.filter((r) => r.userId === userId && ACCEPTED_VERSIONS.has(r.agreementVersion));
  return mine.sort((a, b) => b.consentedAt - a.consentedAt)[0] ?? null;
}

/** Record a change to one consent on the current signed record (no-op if none).
 *  The signed set stays as signed; `current` and `changes` carry the change. */
export async function recordConsentChange(userId: string, key: ConsentKey, value: boolean): Promise<boolean> {
  return enqueue(async () => {
    const store = await readStrict();
    const mine = store.records
      .filter((r) => r.userId === userId && ACCEPTED_VERSIONS.has(r.agreementVersion))
      .sort((a, b) => b.consentedAt - a.consentedAt)[0];
    if (!mine?.consents) return false;
    const now = { ...(mine.current ?? mine.consents) };
    if (now[key] === value) return true;
    now[key] = value;
    mine.current = now;
    (mine.changes ??= []).push({ at: Date.now(), key, value });
    await write(store);
    return true;
  });
}

/** Switch an OPTIONAL consent on or off. Required consents are withdrawn by
 *  disconnecting Groww (recorded) or deleting the account. */
export async function setOptionalConsent(userId: string, key: ConsentKey, value: boolean): Promise<boolean> {
  if (!OPTIONAL_CONSENTS.includes(key)) return false;
  return recordConsentChange(userId, key, value);
}

/** Signed the current agreement, or an earlier version that is still accepted. */
export async function hasConsented(userId: string): Promise<boolean> {
  return (await read()).records.some((r) => r.userId === userId && ACCEPTED_VERSIONS.has(r.agreementVersion));
}
/** Signed the current version itself. Someone on an earlier, still-accepted
 *  version may still open the agreement page and sign this one. */
export async function hasSignedCurrent(userId: string): Promise<boolean> {
  return (await read()).records.some((r) => r.userId === userId && r.agreementVersion === AGREEMENT_VERSION);
}
export async function listConsents(): Promise<ConsentRecord[]> {
  return (await read()).records.slice().sort((a, b) => b.consentedAt - a.consentedAt);
}
export async function deleteConsents(userId: string): Promise<void> {
  return enqueue(async () => {
    const store = await readStrict();
    const before = store.records.length;
    store.records = store.records.filter((r) => r.userId !== userId);
    if (store.records.length !== before) await write(store, true);
  });
}
