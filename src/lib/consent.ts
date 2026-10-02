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

export const AGREEMENT_VERSION = "3.2 · 2026-10-02";

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
    { heading: "1. Who we are", body: "MNHA Financials (“MNHA”, “we”) provides the software at visionmarket.in and is responsible for your personal data under this agreement (the Data Fiduciary). Contact and grievances: support@visionmarket.in. MNHA is independent and is not affiliated with, sponsored by or endorsed by Groww." },
    { heading: "2. What MNHA is — and is not", body: "MNHA is decision-support software that connects, read-only, to your own Groww account. It is not a stock broker, bank, portfolio manager or investment adviser, and it is not registered with SEBI as a Research Analyst or Investment Adviser. It holds none of your money or securities (zero custody), places no orders in your account, and the API key you give it cannot withdraw money. Your trading account stays with your broker." },
    { heading: "3. No tips, no recommendations", body: "MNHA does not give buy or sell tips, recommendations or investment advice. Nothing it shows — a strategy, its status, a market observation, an analysis or historical figures — is an instruction or a recommendation to buy, sell or hold any security. Every decision — whether to trade, what, when, how much, at what price and when to exit — is yours alone, and so is its outcome." },
    { heading: "4. MNHA AI and automated features", body: "MNHA AI is server-based software that studies the NSE with rule-based strategies; your home screen shows its live status. It is a tool to help you understand information. If an automatic-trading feature is ever offered, it will be off by default, described in a new version of this agreement and switched on only with your separate consent — and any profit or loss from it would be entirely yours." },
    { heading: "5. Trading is risky — no guarantee", body: "Trading and investing carry real risk, including losing your entire capital; leveraged products can lose more than you put in. There are no guaranteed returns, no guaranteed profits and no risk-free strategies, and any promise of guaranteed or zero-loss returns — from anyone — is false. Backtested, simulated and past results do not predict the future. SEBI's own studies found that roughly nine in ten individual traders in equity F&O lost money. Do not trade money you cannot afford to lose." },
    { heading: "6. Information we collect", body: "Account: your email address (confirmed with a one-time code we email you) and your password (stored only as a salted hash). Identity verification on this page: a selfie and a photo of your PAN or Aadhaar, and the details in them — used only to verify that you are the person opening the account, to keep evidence that you personally completed this agreement, and to protect account integrity. You can take them on your phone by scanning a QR code: that link works for 15 minutes and can only upload these two photos to your account. They are stored as soon as you upload them, even before you sign. If you also complete MNHA's optional verification, we collect your full name, PAN, date of birth, postal address, a selfie and an ID document, and may hold a live video call with you; PAN and date of birth are stored encrypted. Identity images are stored as files on our server, outside public access. We treat all of these as sensitive." },
    { heading: "7. Connecting your Groww account", body: "Connecting Groww is a separate step. You sign in on Groww's own website and create the API key and TOTP secret there; we never ask for, receive or see your Groww password, PIN or one-time OTP. We verify the key live with Groww and store it encrypted (AES-256). With it, MNHA only reads: your Groww client code and enabled segments, balance, holdings, positions, order book and fills, and the live quotes and option chains shown on your desk — to show your desk and to work out round-trip analysis from your actual fills. Adding MNHA's static server IP to your key is optional: a static IP is required only for orders sent through the API." },
    { heading: "8. Why we use your information", body: "Only for the purposes in this agreement: creating, securing and running your account; signing you in; verifying your identity and recording your acknowledgement; connecting Groww when you ask and reading the permitted information; showing your desk and your analysis; keeping the service secure; meeting legal obligations; and handling your requests and grievances." },
    { heading: "9. Where your data is stored, and who processes it", body: "Your data is stored on our servers, run by our hosting provider (Hostinger) in the United States, so it is processed outside India. Groww supplies the account data you ask us to read; public market data also comes from other market-data sources, and no personal data is sent to them. Account emails, such as your sign-up code, are sent through Google's Gmail service, which receives your email address and the message. If a live verification call is arranged, it takes place on the video-meeting service named in the invitation, and MNHA does not record it. If recorded read-aloud is switched on, only the text of this agreement is sent to Microsoft Azure to make the audio. We use no third-party analytics, advertising or marketing-email services today, and we do not sell your personal data." },
    { heading: "10. How long we keep it", body: "Your account details, identity materials (selfie, ID photo) and verification details: until you delete your account. Your Groww key and client code: until you disconnect Groww or delete your account, whichever comes first. The rest of your Groww account data is not stored — it is read live each time you open a page. Your consent records and notifications: until you delete your account. Membership invoices, if any: kept after account deletion as billing records, used only for accounting and legal purposes. Server logs used for security and troubleshooting rotate out automatically." },
    { heading: "11. Your rights and choices", body: "You may ask what personal data we process and how; access it; correct or update it; have it erased when it no longer needs to be kept; withdraw a consent; and raise a grievance. Withdrawing a consent does not undo processing that was lawful before it, and withdrawing a required consent may mean we cannot continue that part of the service." },
    { heading: "12. Withdrawing consent, disconnecting and deleting", body: "In Settings → Privacy & consents you can switch optional consents off at any time — as easily as you gave them. Settings → Disconnect broker removes your stored Groww key at once and records the withdrawal of your Groww consent; you can also revoke the key on Groww. Settings → Delete account erases your account and personal data immediately — everything except billing records and server logs, including the backup copies our software keeps (an active membership must be left, and any unpaid invoice settled, first). Settings stays open to you even before you sign this version or connect Groww. You can also write to support@visionmarket.in." },
    { heading: "13. Marketing, analytics and cookies", body: "Marketing messages (email, SMS or WhatsApp) and non-essential analytics or cookies are optional, separate, and only for users who opt in; refusing or withdrawing them never limits the core service. Today we send no marketing and use no analytics tools or non-essential cookies — only a strictly necessary sign-in cookie (valid for eight hours) and a display-theme setting stored in your browser." },
    { heading: "14. Your consent record", body: "We keep evidence of your consent: the agreement version and its fingerprint, every language you viewed, each box you ticked, your typed signature, the date and time, your IP address and device, your selfie and ID photo, and any later change or withdrawal." },
    { heading: "15. The service, liability, changes and law", body: "The service is provided “as is”, without warranties, to the extent the law allows; it may be delayed, interrupted or show wrong data, so always check your broker for anything important. MNHA is not liable for trading losses, downtime or data errors. We may update this agreement; a material change will ask you to accept again. It is governed by the laws of India, including the Digital Personal Data Protection Act, 2023 and its Rules." },
    { heading: "16. Questions and grievances", body: "For questions, data requests or grievances, write to support@visionmarket.in. We aim to respond within a couple of business days. Where the Digital Personal Data Protection Act applies, you may also use the remedies it gives a Data Principal, including a complaint to the Data Protection Board of India." },
  ],
  consents: [
    { key: "account", label: "Account, terms & privacy", text: "I agree to create an MNHA Financials account and accept this agreement, including the Terms of Use, Privacy Policy and Risk Disclosure. I understand that my personal data will be processed as described above." },
    { key: "identity", label: "Identity verification", text: "I consent to MNHA collecting and storing my selfie and photo ID to verify my identity and protect my account, as described above." },
    { key: "groww", label: "Groww connection, read-only", text: "I consent to MNHA storing my Groww API key and TOTP secret in encrypted form and using them only to read my Groww client code, balance, holdings, positions, order book, fills and live market data, to run my desk and my round-trip analysis." },
    { key: "risk", label: "Status & risk", text: "I understand that MNHA is not a broker, Research Analyst or Investment Adviser, does not recommend that I buy or sell any security, places no orders for me, and that trading can cause substantial losses." },
    { key: "marketing", label: "Marketing", text: "I agree to receive optional MNHA marketing messages by email, SMS and/or WhatsApp. I can withdraw this at any time without losing the core service." },
    { key: "analytics", label: "Analytics & cookies", text: "I agree to optional analytics and non-essential cookies that help MNHA understand how its website and software are used. I can withdraw this at any time without losing essential functions." },
  ],
  spokenAck:
    "I am signing this of my own free will. I understand that MNHA Financials gives me no buy or sell tips and places no orders for me, that every trading decision is my own responsibility, that trading is risky and I can lose money, and that there is no guaranteed return. I have read and understood this agreement.",
  ui: {
    timeDone: "Reading time complete",
    uploading: "Uploading…",
    uploadFailed: "Upload failed — please try again.",
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
  },
};

const hi: ContractLang = {
  title: "उपयोगकर्ता अनुबंध, जोखिम प्रकटीकरण एवं डेटा सहमति",
  org: { name: "MNHA FINANCIALS", tagline: "आपका खाता, साफ़ नज़र में।", meta: `अनुबंध संस्करण ${AGREEMENT_VERSION}` },
  intro:
    "यह आपके और MNHA Financials के बीच का अनुबंध है। इसमें बताया गया है कि यह सेवा क्या है, ट्रेडिंग के जोखिम क्या हैं, और हम आपके व्यक्तिगत डेटा को कैसे संभालते हैं। इसे English, हिन्दी या ગુજરાતી में पूरा पढ़ें — या सुनें — फिर अंत में अलग-अलग सहमतियाँ दें और हस्ताक्षर करें। आप हर संस्करण को एक बार स्वीकार करते हैं। वह भाषा चुनें जो आप समझते हैं, फिर सहमति दें। अंग्रेज़ी पाठ संदर्भ संस्करण है।",
  sections: [
    { heading: "1. हम कौन हैं", body: "MNHA Financials (“MNHA”, “हम”) visionmarket.in पर सॉफ़्टवेयर उपलब्ध कराता है और इस अनुबंध के तहत आपके व्यक्तिगत डेटा के लिए ज़िम्मेदार है (डेटा फ़िड्यूशियरी)। संपर्क और शिकायत: support@visionmarket.in. MNHA स्वतंत्र है और Groww से संबद्ध, प्रायोजित या समर्थित नहीं है।" },
    { heading: "2. MNHA क्या है — और क्या नहीं", body: "MNHA निर्णय-सहायक सॉफ़्टवेयर है जो आपके अपने Groww खाते से केवल पढ़ने (read-only) के लिए जुड़ता है। यह स्टॉक ब्रोकर, बैंक, पोर्टफ़ोलियो मैनेजर या निवेश सलाहकार नहीं है, और SEBI में रिसर्च एनालिस्ट या निवेश सलाहकार के रूप में पंजीकृत नहीं है। यह आपका कोई पैसा या प्रतिभूतियाँ नहीं रखता (शून्य कस्टडी), आपके खाते में कोई ऑर्डर नहीं लगाता, और जो API key आप देते हैं उससे पैसा नहीं निकाला जा सकता। आपका ट्रेडिंग खाता आपके ब्रोकर के पास ही रहता है।" },
    { heading: "3. कोई टिप नहीं, कोई सिफ़ारिश नहीं", body: "MNHA खरीद-बिक्री की टिप, सिफ़ारिश या निवेश सलाह नहीं देता। यह जो कुछ भी दिखाता है — कोई रणनीति, उसकी स्थिति, बाज़ार का अवलोकन, विश्लेषण या पुराने आँकड़े — वह किसी भी प्रतिभूति को खरीदने, बेचने या रखने का निर्देश या सिफ़ारिश नहीं है। हर निर्णय — ट्रेड करना है या नहीं, क्या, कब, कितना, किस भाव पर और कब निकलना है — सिर्फ़ आपका है, और उसका परिणाम भी।" },
    { heading: "4. MNHA AI और स्वचालित फ़ीचर", body: "MNHA AI सर्वर पर चलने वाला सॉफ़्टवेयर है जो नियम-आधारित रणनीतियों से NSE का अध्ययन करता है; आपकी होम स्क्रीन पर इसकी लाइव स्थिति दिखती है। यह जानकारी समझने में मदद करने वाला एक टूल है। यदि कभी स्वचालित ट्रेडिंग फ़ीचर दिया जाता है, तो वह डिफ़ॉल्ट रूप से बंद रहेगा, इस अनुबंध के नए संस्करण में बताया जाएगा और केवल आपकी अलग सहमति से चालू होगा — और उससे होने वाला कोई भी मुनाफ़ा या नुकसान पूरी तरह आपका होगा।" },
    { heading: "5. ट्रेडिंग जोखिम भरी है — कोई गारंटी नहीं", body: "ट्रेडिंग और निवेश में वास्तविक जोखिम है, आपकी पूरी पूँजी डूब सकती है; लीवरेज वाले प्रोडक्ट में लगाई गई रकम से ज़्यादा नुकसान हो सकता है। कोई गारंटीड रिटर्न, गारंटीड मुनाफ़ा या जोखिम-मुक्त रणनीति नहीं है, और गारंटीड या ज़ीरो-लॉस रिटर्न का कोई भी वादा — किसी का भी — झूठा है। बैकटेस्ट, सिमुलेशन और पिछले नतीजे भविष्य नहीं बताते। SEBI के अपने अध्ययनों में पाया गया कि इक्विटी F&O में लगभग दस में से नौ व्यक्तिगत ट्रेडरों को नुकसान हुआ। वह पैसा ट्रेड न करें जिसे खोना आप सहन नहीं कर सकते।" },
    { heading: "6. हम कौन-सी जानकारी लेते हैं", body: "खाता: आपका ईमेल पता (जिसकी पुष्टि हम आपको ईमेल किए गए एक बार के कोड से करते हैं) और पासवर्ड (केवल सॉल्टेड हैश के रूप में रखा जाता है)। इस पेज पर पहचान सत्यापन: एक सेल्फ़ी और आपके PAN या आधार की फ़ोटो, और उनमें मौजूद विवरण — केवल यह सत्यापित करने के लिए कि खाता खोलने वाले आप ही हैं, यह प्रमाण रखने के लिए कि यह अनुबंध आपने स्वयं पूरा किया, और खाते की सुरक्षा के लिए। आप QR कोड स्कैन करके ये फ़ोटो अपने फ़ोन पर ले सकते हैं: वह लिंक 15 मिनट तक काम करता है और आपके खाते में केवल ये दो फ़ोटो अपलोड कर सकता है। अपलोड करते ही ये रख लिए जाते हैं, साइन करने से पहले भी। यदि आप MNHA का वैकल्पिक सत्यापन भी करते हैं, तो हम आपका पूरा नाम, PAN, जन्मतिथि, डाक पता, एक सेल्फ़ी और एक ID दस्तावेज़ लेते हैं, और आपके साथ एक लाइव वीडियो कॉल कर सकते हैं; PAN और जन्मतिथि एन्क्रिप्टेड रखे जाते हैं। पहचान की तस्वीरें हमारे सर्वर पर फ़ाइलों के रूप में, सार्वजनिक पहुँच से बाहर रखी जाती हैं। हम इन सबको संवेदनशील मानते हैं।" },
    { heading: "7. आपका Groww खाता जोड़ना", body: "Groww जोड़ना एक अलग चरण है। आप Groww की अपनी वेबसाइट पर साइन इन करते हैं और वहीं API key और TOTP secret बनाते हैं; हम आपका Groww पासवर्ड, PIN या OTP कभी नहीं माँगते, न प्राप्त करते हैं, न देखते हैं। हम key को Groww से लाइव सत्यापित करते हैं और उसे एन्क्रिप्टेड (AES-256) रखते हैं। इससे MNHA केवल पढ़ता है: आपका Groww क्लाइंट कोड और चालू सेगमेंट, बैलेंस, होल्डिंग्स, पोज़िशन, ऑर्डर बुक और फ़िल, और आपकी डेस्क पर दिखने वाले लाइव भाव व ऑप्शन चेन — ताकि आपकी डेस्क दिखा सके और आपके असली फ़िल से राउंड-ट्रिप विश्लेषण कर सके। अपनी key पर MNHA का स्टैटिक सर्वर IP जोड़ना वैकल्पिक है: स्टैटिक IP केवल API से भेजे गए ऑर्डर के लिए ज़रूरी होता है।" },
    { heading: "8. हम आपकी जानकारी का उपयोग क्यों करते हैं", body: "केवल इस अनुबंध में बताए उद्देश्यों के लिए: आपका खाता बनाना, सुरक्षित रखना और चलाना; आपको साइन इन कराना; आपकी पहचान सत्यापित करना और आपकी स्वीकृति दर्ज करना; आपके कहने पर Groww जोड़ना और अनुमत जानकारी पढ़ना; आपकी डेस्क और विश्लेषण दिखाना; सेवा को सुरक्षित रखना; कानूनी दायित्व पूरे करना; और आपके अनुरोध व शिकायतें संभालना।" },
    { heading: "9. आपका डेटा कहाँ रखा जाता है और कौन प्रोसेस करता है", body: "आपका डेटा हमारे सर्वरों पर रखा जाता है, जिन्हें हमारा होस्टिंग प्रदाता (Hostinger) संयुक्त राज्य अमेरिका में चलाता है, यानी इसकी प्रोसेसिंग भारत के बाहर होती है। आप जिस खाता-डेटा को पढ़ने के लिए कहते हैं, वह Groww देता है; सार्वजनिक बाज़ार-डेटा अन्य बाज़ार-डेटा स्रोतों से भी आता है, और उन्हें कोई व्यक्तिगत डेटा नहीं भेजा जाता। खाते से जुड़े ईमेल, जैसे साइन-अप कोड, Google की Gmail सेवा से भेजे जाते हैं, जिसे आपका ईमेल पता और संदेश मिलता है। यदि लाइव सत्यापन कॉल तय होती है, तो वह निमंत्रण में बताई गई वीडियो-मीटिंग सेवा पर होती है, और MNHA उसे रिकॉर्ड नहीं करता। यदि रिकॉर्ड की गई ऑडियो सुविधा चालू है, तो ऑडियो बनाने के लिए केवल इस अनुबंध का पाठ Microsoft Azure को भेजा जाता है। आज हम कोई थर्ड-पार्टी एनालिटिक्स, विज्ञापन या ईमेल-मार्केटिंग सेवा उपयोग नहीं करते, और हम आपका व्यक्तिगत डेटा नहीं बेचते।" },
    { heading: "10. हम इसे कितने समय तक रखते हैं", body: "आपके खाते का विवरण, पहचान सामग्री (सेल्फ़ी, ID फ़ोटो) और सत्यापन विवरण: जब तक आप अपना खाता नहीं हटाते। आपकी Groww key और क्लाइंट कोड: जब तक आप Groww डिस्कनेक्ट नहीं करते या खाता नहीं हटाते — जो पहले हो। आपके Groww खाते का बाकी डेटा रखा नहीं जाता — हर बार पेज खोलने पर लाइव पढ़ा जाता है। आपके सहमति रिकॉर्ड और सूचनाएँ: जब तक आप खाता नहीं हटाते। मेंबरशिप इनवॉइस, यदि कोई हों: खाता हटाने के बाद भी बिलिंग रिकॉर्ड के रूप में रखे जाते हैं, केवल लेखा और कानूनी उद्देश्यों के लिए। सुरक्षा और समस्या-निवारण के सर्वर लॉग अपने-आप रोटेट होकर हट जाते हैं।" },
    { heading: "11. आपके अधिकार और विकल्प", body: "आप पूछ सकते हैं कि हम आपका कौन-सा व्यक्तिगत डेटा कैसे प्रोसेस करते हैं; उसे देख सकते हैं; उसे सुधार या अपडेट कर सकते हैं; ज़रूरत न रहने पर उसे मिटवा सकते हैं; कोई सहमति वापस ले सकते हैं; और शिकायत कर सकते हैं। सहमति वापस लेने से पहले हुई वैध प्रोसेसिंग अमान्य नहीं होती, और कोई ज़रूरी सहमति वापस लेने पर संभव है कि हम सेवा का वह हिस्सा जारी न रख पाएँ।" },
    { heading: "12. सहमति वापस लेना, डिस्कनेक्ट करना और खाता हटाना", body: "Settings → “Privacy & consents” (प्राइवेसी और सहमतियाँ) में आप वैकल्पिक सहमतियाँ कभी भी बंद कर सकते हैं — उतनी ही आसानी से, जितनी आसानी से आपने उन्हें दिया था। Settings → “Disconnect broker” (ब्रोकर डिस्कनेक्ट करें) से आपकी Groww key तुरंत हट जाती है और आपकी Groww सहमति की वापसी दर्ज होती है; आप Groww पर भी key रद्द कर सकते हैं। Settings → “Delete account” (खाता हटाएँ) से आपका खाता और व्यक्तिगत डेटा तुरंत मिट जाता है — बिलिंग रिकॉर्ड और सर्वर लॉग को छोड़कर सब कुछ, हमारे सॉफ़्टवेयर की बैकअप प्रतियों सहित (पहले चालू मेंबरशिप छोड़नी होगी और बकाया इनवॉइस चुकाना होगा)। यह संस्करण साइन करने या Groww जोड़ने से पहले भी Settings आपके लिए खुला रहता है। आप support@visionmarket.in पर भी लिख सकते हैं।" },
    { heading: "13. मार्केटिंग, एनालिटिक्स और कुकीज़", body: "मार्केटिंग संदेश (ईमेल, SMS या WhatsApp) और गैर-ज़रूरी एनालिटिक्स या कुकीज़ वैकल्पिक और अलग हैं, और केवल सहमति देने वालों के लिए हैं; इन्हें मना करने या वापस लेने से मूल सेवा कभी सीमित नहीं होती। आज हम कोई मार्केटिंग नहीं भेजते और कोई एनालिटिक्स टूल या गैर-ज़रूरी कुकी उपयोग नहीं करते — केवल एक अनिवार्य साइन-इन कुकी (आठ घंटे के लिए मान्य) और आपके ब्राउज़र में रखी गई थीम सेटिंग।" },
    { heading: "14. आपकी सहमति का रिकॉर्ड", body: "हम आपकी सहमति का प्रमाण रखते हैं: अनुबंध का संस्करण और उसका फ़िंगरप्रिंट, आपके द्वारा देखी गई हर भाषा, आपके द्वारा टिक किया गया हर बॉक्स, आपका टाइप किया हस्ताक्षर, दिनांक और समय, आपका IP पता और डिवाइस, आपकी सेल्फ़ी और ID फ़ोटो, और बाद का कोई भी बदलाव या वापसी।" },
    { heading: "15. सेवा, दायित्व, बदलाव और कानून", body: "सेवा “जैसी है वैसी”, बिना वारंटी के, कानून की अनुमति तक दी जाती है; इसमें देरी, रुकावट या गलत डेटा हो सकता है, इसलिए ज़रूरी बात हमेशा अपने ब्रोकर पर जाँचें। MNHA ट्रेडिंग नुकसान, डाउनटाइम या डेटा त्रुटि के लिए ज़िम्मेदार नहीं है। हम यह अनुबंध बदल सकते हैं; बड़ा बदलाव आपसे फिर स्वीकृति माँगेगा। यह भारत के कानूनों के अधीन है, जिसमें डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 और उसके नियम शामिल हैं।" },
    { heading: "16. प्रश्न और शिकायतें", body: "प्रश्न, डेटा अनुरोध या शिकायत के लिए support@visionmarket.in पर लिखें। हम कुछ कार्यदिवसों में जवाब देने का प्रयास करते हैं। जहाँ डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम लागू होता है, वहाँ आप डेटा प्रिंसिपल को मिलने वाले उपाय भी अपना सकते हैं, जिसमें भारतीय डेटा संरक्षण बोर्ड में शिकायत शामिल है।" },
  ],
  consents: [
    { key: "account", label: "खाता, शर्तें और प्राइवेसी", text: "मैं MNHA Financials खाता बनाने और यह अनुबंध — उपयोग की शर्तें, प्राइवेसी नीति और जोखिम प्रकटीकरण सहित — स्वीकार करने के लिए सहमत हूँ। मैं समझता/समझती हूँ कि मेरा व्यक्तिगत डेटा ऊपर बताए अनुसार प्रोसेस होगा।" },
    { key: "identity", label: "पहचान सत्यापन", text: "मैं अपनी पहचान सत्यापित करने और अपने खाते की सुरक्षा के लिए MNHA को मेरी सेल्फ़ी और फ़ोटो ID लेने और रखने की सहमति देता/देती हूँ, जैसा ऊपर बताया गया है।" },
    { key: "groww", label: "Groww कनेक्शन, केवल पढ़ने के लिए", text: "मैं MNHA को मेरी Groww API key और TOTP secret एन्क्रिप्टेड रखने और उनसे केवल मेरा Groww क्लाइंट कोड, बैलेंस, होल्डिंग्स, पोज़िशन, ऑर्डर बुक, फ़िल और लाइव बाज़ार-डेटा पढ़ने की सहमति देता/देती हूँ, ताकि मेरी डेस्क और राउंड-ट्रिप विश्लेषण चल सके।" },
    { key: "risk", label: "स्थिति और जोखिम", text: "मैं समझता/समझती हूँ कि MNHA ब्रोकर, रिसर्च एनालिस्ट या निवेश सलाहकार नहीं है, मुझे कोई प्रतिभूति खरीदने या बेचने की सिफ़ारिश नहीं करता, मेरे लिए कोई ऑर्डर नहीं लगाता, और ट्रेडिंग से भारी नुकसान हो सकता है।" },
    { key: "marketing", label: "मार्केटिंग", text: "मैं ईमेल, SMS और/या WhatsApp से MNHA के वैकल्पिक मार्केटिंग संदेश पाने के लिए सहमत हूँ। मैं इसे कभी भी वापस ले सकता/सकती हूँ, मूल सेवा खोए बिना।" },
    { key: "analytics", label: "एनालिटिक्स और कुकीज़", text: "मैं वैकल्पिक एनालिटिक्स और गैर-ज़रूरी कुकीज़ के लिए सहमत हूँ, जिनसे MNHA समझ सके कि उसकी वेबसाइट और सॉफ़्टवेयर कैसे उपयोग होते हैं। मैं इसे कभी भी वापस ले सकता/सकती हूँ, ज़रूरी सुविधाएँ खोए बिना।" },
  ],
  spokenAck:
    "मैं यह अपनी मर्ज़ी से साइन कर रहा/रही हूँ। मैं समझता/समझती हूँ कि MNHA Financials मुझे खरीद-बिक्री की कोई टिप नहीं देता और मेरे लिए कोई ऑर्डर नहीं लगाता, कि ट्रेडिंग का हर निर्णय मेरी अपनी ज़िम्मेदारी है, कि ट्रेडिंग जोखिम भरी है और मेरा पैसा डूब सकता है, और कोई गारंटीड रिटर्न नहीं है। मैंने यह अनुबंध पढ़ और समझ लिया है।",
  ui: {
    timeDone: "पढ़ने का समय पूरा",
    uploading: "अपलोड हो रहा है…",
    uploadFailed: "अपलोड नहीं हो सका — कृपया फिर कोशिश करें।",
    signName: "साइन करने के लिए अपना पूरा नाम लिखें।",
    mediaStale: "इस बार साइन करने के लिए कृपया अपनी सेल्फ़ी और ID फ़ोटो फिर से जोड़ें।",
    before: "शुरू करने से पहले",
    subtitle: "पूरा अनुबंध पढ़ें या सुनें, फ़ोन पर अपनी पहचान सत्यापित करें, सहमतियाँ दें और साइन करें।",
    language: "भाषा", listen: "सुनें", pause: "रोकें", playing: "पढ़ा जा रहा है…", loadingAudio: "ऑडियो तैयार हो रहा है…",
    noVoice: "इस ब्राउज़र में इस भाषा की आवाज़ नहीं है। यह पेज Microsoft Edge में, या Android पर Chrome में खोलें — या ऊपर का पाठ पढ़ें।",
    readToEnd: "जारी रखने के लिए अंत तक स्क्रॉल करें", readDone: "अंत तक पढ़ लिया", listenDone: "अनुबंध सुन लिया",
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
  },
};

const gu: ContractLang = {
  title: "વપરાશકર્તા કરાર, જોખમ ડિસ્ક્લોઝર અને ડેટા સંમતિ",
  org: { name: "MNHA FINANCIALS", tagline: "તમારું ખાતું, સ્પષ્ટ નજરે.", meta: `કરાર આવૃત્તિ ${AGREEMENT_VERSION}` },
  intro:
    "આ તમારા અને MNHA Financials વચ્ચેનો કરાર છે. એમાં આ સેવા શું છે, ટ્રેડિંગનાં જોખમો શું છે, અને અમે તમારો વ્યક્તિગત ડેટા કેવી રીતે સંભાળીએ છીએ એ જણાવ્યું છે. એને English, हिन्दी કે ગુજરાતીમાં પૂરો વાંચો — અથવા સાંભળો — પછી છેલ્લે અલગ-અલગ સંમતિઓ આપો અને સહી કરો. તમે દરેક આવૃત્તિ એક વાર સ્વીકારો છો. તમે સમજો એ ભાષા પસંદ કરો, પછી સંમતિ આપો. અંગ્રેજી લખાણ સંદર્ભ આવૃત્તિ છે.",
  sections: [
    { heading: "1. અમે કોણ છીએ", body: "MNHA Financials (“MNHA”, “અમે”) visionmarket.in પર સૉફ્ટવેર પૂરું પાડે છે અને આ કરાર હેઠળ તમારા વ્યક્તિગત ડેટા માટે જવાબદાર છે (ડેટા ફિડ્યુશિયરી). સંપર્ક અને ફરિયાદ: support@visionmarket.in. MNHA સ્વતંત્ર છે અને Groww સાથે સંકળાયેલ, પ્રાયોજિત કે સમર્થિત નથી." },
    { heading: "2. MNHA શું છે — અને શું નથી", body: "MNHA નિર્ણય-સહાયક સૉફ્ટવેર છે જે તમારા પોતાના Groww ખાતા સાથે ફક્ત વાંચવા (read-only) માટે જોડાય છે. એ સ્ટોક બ્રોકર, બેંક, પોર્ટફોલિયો મેનેજર કે ઇન્વેસ્ટમેન્ટ એડવાઇઝર નથી, અને SEBI માં રિસર્ચ એનાલિસ્ટ કે ઇન્વેસ્ટમેન્ટ એડવાઇઝર તરીકે નોંધાયેલ નથી. એ તમારા કોઈ પૈસા કે સિક્યુરિટીઝ રાખતું નથી (શૂન્ય કસ્ટડી), તમારા ખાતામાં કોઈ ઓર્ડર મૂકતું નથી, અને તમે આપેલી API key થી પૈસા ઉપાડી શકાતા નથી. તમારું ટ્રેડિંગ ખાતું તમારા બ્રોકર પાસે જ રહે છે." },
    { heading: "3. કોઈ ટિપ નહીં, કોઈ ભલામણ નહીં", body: "MNHA ખરીદ-વેચાણની ટિપ, ભલામણ કે ઇન્વેસ્ટમેન્ટ સલાહ આપતું નથી. એ જે કંઈ બતાવે — કોઈ સ્ટ્રેટેજી, એની સ્થિતિ, બજારનું અવલોકન, વિશ્લેષણ કે જૂના આંકડા — એ કોઈ પણ સિક્યુરિટી ખરીદવા, વેચવા કે રાખવાની સૂચના કે ભલામણ નથી. દરેક નિર્ણય — ટ્રેડ કરવો કે નહીં, શું, ક્યારે, કેટલું, કયા ભાવે અને ક્યારે બહાર નીકળવું — ફક્ત તમારો છે, અને એનું પરિણામ પણ." },
    { heading: "4. MNHA AI અને ઓટોમેટેડ ફીચર", body: "MNHA AI સર્વર પર ચાલતું સૉફ્ટવેર છે જે નિયમ-આધારિત સ્ટ્રેટેજીથી NSE નો અભ્યાસ કરે છે; તમારી હોમ સ્ક્રીન પર એની લાઇવ સ્થિતિ દેખાય છે. એ માહિતી સમજવામાં મદદ કરતું ટૂલ છે. જો ક્યારેય ઓટોમેટિક ટ્રેડિંગ ફીચર આપવામાં આવે, તો એ ડિફોલ્ટમાં બંધ રહેશે, આ કરારની નવી આવૃત્તિમાં જણાવાશે અને ફક્ત તમારી અલગ સંમતિથી જ ચાલુ થશે — અને એનાથી થતો કોઈ પણ નફો કે નુકસાન સંપૂર્ણપણે તમારો રહેશે." },
    { heading: "5. ટ્રેડિંગ જોખમી છે — કોઈ ગેરંટી નહીં", body: "ટ્રેડિંગ અને રોકાણમાં ખરું જોખમ છે, તમારી આખી મૂડી ડૂબી શકે છે; લીવરેજવાળાં પ્રોડક્ટમાં મૂકેલી રકમ કરતાં વધુ નુકસાન થઈ શકે છે. કોઈ ગેરંટીડ રિટર્ન, ગેરંટીડ નફો કે જોખમ-મુક્ત સ્ટ્રેટેજી નથી, અને ગેરંટીડ કે ઝીરો-લોસ રિટર્નનું કોઈ પણ વચન — કોઈનું પણ — ખોટું છે. બેકટેસ્ટ, સિમ્યુલેશન અને ભૂતકાળનાં પરિણામો ભવિષ્ય બતાવતાં નથી. SEBI ના પોતાના અભ્યાસમાં જણાયું કે ઇક્વિટી F&O માં લગભગ દસમાંથી નવ વ્યક્તિગત ટ્રેડરોને નુકસાન થયું. જે પૈસા ગુમાવવાનું તમને પરવડે નહીં એનાથી ટ્રેડ ન કરો." },
    { heading: "6. અમે કઈ માહિતી લઈએ છીએ", body: "ખાતું: તમારું ઈમેલ સરનામું (જેની ખાતરી અમે તમને ઈમેલ કરેલા એક વખતના કોડથી કરીએ છીએ) અને પાસવર્ડ (ફક્ત સૉલ્ટેડ હેશ તરીકે રખાય છે). આ પેજ પર ઓળખની ખરાઈ: એક સેલ્ફી અને તમારા PAN કે આધારનો ફોટો, અને એમાંની વિગતો — ફક્ત એ ચકાસવા માટે કે ખાતું ખોલનાર તમે જ છો, આ કરાર તમે જાતે પૂરો કર્યો એનો પુરાવો રાખવા માટે, અને ખાતાની સુરક્ષા માટે. તમે QR કોડ સ્કેન કરીને આ ફોટા તમારા ફોન પર લઈ શકો છો: એ લિંક 15 મિનિટ ચાલે છે અને તમારા ખાતામાં ફક્ત આ બે ફોટા અપલોડ કરી શકે છે. અપલોડ કરતાં જ એ રાખી લેવાય છે, સહી કરતાં પહેલાં પણ. જો તમે MNHA ની વૈકલ્પિક ખરાઈ પણ કરો, તો અમે તમારું પૂરું નામ, PAN, જન્મતારીખ, ટપાલ સરનામું, એક સેલ્ફી અને એક ID દસ્તાવેજ લઈએ છીએ, અને તમારી સાથે લાઇવ વીડિયો કૉલ કરી શકીએ છીએ; PAN અને જન્મતારીખ એન્ક્રિપ્ટેડ રખાય છે. ઓળખની તસવીરો અમારા સર્વર પર ફાઇલો તરીકે, જાહેર પહોંચથી બહાર રખાય છે. અમે આ બધાને સંવેદનશીલ ગણીએ છીએ." },
    { heading: "7. તમારું Groww ખાતું જોડવું", body: "Groww જોડવું એ અલગ પગલું છે. તમે Groww ની પોતાની વેબસાઇટ પર સાઇન ઇન કરો છો અને ત્યાં જ API key અને TOTP secret બનાવો છો; અમે તમારો Groww પાસવર્ડ, PIN કે OTP ક્યારેય માંગતા નથી, મેળવતા નથી કે જોતા નથી. અમે key ને Groww સાથે લાઇવ ચકાસીએ છીએ અને એને એન્ક્રિપ્ટેડ (AES-256) રાખીએ છીએ. એનાથી MNHA ફક્ત વાંચે છે: તમારો Groww ક્લાયન્ટ કોડ અને ચાલુ સેગમેન્ટ, બેલેન્સ, હોલ્ડિંગ્સ, પોઝિશન, ઓર્ડર બુક અને ફિલ, અને તમારા ડેસ્ક પર દેખાતા લાઇવ ભાવ અને ઓપ્શન ચેઇન — જેથી તમારું ડેસ્ક બતાવી શકે અને તમારા ખરા ફિલ પરથી રાઉન્ડ-ટ્રિપ વિશ્લેષણ કરી શકે. તમારી key પર MNHA નો સ્ટેટિક સર્વર IP ઉમેરવો વૈકલ્પિક છે: સ્ટેટિક IP ફક્ત API થી મોકલાતા ઓર્ડર માટે જરૂરી છે." },
    { heading: "8. અમે તમારી માહિતી શા માટે વાપરીએ છીએ", body: "ફક્ત આ કરારમાં જણાવેલા હેતુઓ માટે: તમારું ખાતું બનાવવું, સુરક્ષિત રાખવું અને ચલાવવું; તમને સાઇન ઇન કરાવવા; તમારી ઓળખ ચકાસવી અને તમારી સ્વીકૃતિ નોંધવી; તમારા કહેવાથી Groww જોડવું અને માન્ય માહિતી વાંચવી; તમારું ડેસ્ક અને વિશ્લેષણ બતાવવું; સેવાને સુરક્ષિત રાખવી; કાનૂની જવાબદારીઓ પૂરી કરવી; અને તમારી વિનંતીઓ અને ફરિયાદો સંભાળવી." },
    { heading: "9. તમારો ડેટા ક્યાં રખાય છે અને કોણ પ્રોસેસ કરે છે", body: "તમારો ડેટા અમારા સર્વર પર રખાય છે, જે અમારો હોસ્ટિંગ પ્રદાતા (Hostinger) અમેરિકામાં ચલાવે છે, એટલે એની પ્રોસેસિંગ ભારતની બહાર થાય છે. તમે જે ખાતા-ડેટા વાંચવાનું કહો છો એ Groww આપે છે; જાહેર બજાર-ડેટા બીજા બજાર-ડેટા સ્ત્રોતોમાંથી પણ આવે છે, અને એમને કોઈ વ્યક્તિગત ડેટા મોકલાતો નથી. ખાતાને લગતા ઈમેલ, જેમ કે સાઇન-અપ કોડ, Google ની Gmail સેવા દ્વારા મોકલાય છે, જેને તમારું ઈમેલ સરનામું અને સંદેશ મળે છે. જો લાઇવ ખરાઈ કૉલ નક્કી થાય, તો એ આમંત્રણમાં જણાવેલી વીડિયો-મીટિંગ સેવા પર થાય છે, અને MNHA એને રેકોર્ડ કરતું નથી. જો રેકોર્ડ કરેલા ઓડિયોની સુવિધા ચાલુ હોય, તો ઓડિયો બનાવવા માટે ફક્ત આ કરારનું લખાણ Microsoft Azure ને મોકલાય છે. આજે અમે કોઈ થર્ડ-પાર્ટી એનાલિટિક્સ, જાહેરાત કે ઈમેલ-માર્કેટિંગ સેવા વાપરતા નથી, અને અમે તમારો વ્યક્તિગત ડેટા વેચતા નથી." },
    { heading: "10. અમે એ કેટલો સમય રાખીએ છીએ", body: "તમારા ખાતાની વિગતો, ઓળખ સામગ્રી (સેલ્ફી, ID ફોટો) અને ખરાઈ વિગતો: તમે તમારું ખાતું ડિલીટ ન કરો ત્યાં સુધી. તમારી Groww key અને ક્લાયન્ટ કોડ: તમે Groww ડિસ્કનેક્ટ ન કરો કે ખાતું ડિલીટ ન કરો — બેમાંથી જે પહેલું થાય ત્યાં સુધી. તમારા Groww ખાતાનો બાકીનો ડેટા રખાતો નથી — દરેક વખતે પેજ ખોલો ત્યારે લાઇવ વંચાય છે. તમારા સંમતિ રેકોર્ડ અને નોટિફિકેશન: તમે ખાતું ડિલીટ ન કરો ત્યાં સુધી. મેમ્બરશિપ ઇનવૉઇસ, જો કોઈ હોય તો: ખાતું ડિલીટ કર્યા પછી પણ બિલિંગ રેકોર્ડ તરીકે રખાય છે, ફક્ત હિસાબ અને કાનૂની હેતુઓ માટે. સુરક્ષા અને સમસ્યા-નિવારણ માટેના સર્વર લૉગ આપમેળે રોટેટ થઈને દૂર થાય છે." },
    { heading: "11. તમારા અધિકારો અને વિકલ્પો", body: "તમે પૂછી શકો કે અમે તમારો કયો વ્યક્તિગત ડેટા કેવી રીતે પ્રોસેસ કરીએ છીએ; એ જોઈ શકો; એ સુધારી કે અપડેટ કરી શકો; જરૂર ન રહે ત્યારે એ ભૂંસાવી શકો; કોઈ સંમતિ પાછી ખેંચી શકો; અને ફરિયાદ કરી શકો. સંમતિ પાછી ખેંચવાથી એ પહેલાં થયેલી કાયદેસર પ્રોસેસિંગ અમાન્ય થતી નથી, અને કોઈ જરૂરી સંમતિ પાછી ખેંચવાથી એવું બને કે અમે સેવાનો એ ભાગ ચાલુ ન રાખી શકીએ." },
    { heading: "12. સંમતિ પાછી ખેંચવી, ડિસ્કનેક્ટ કરવું અને ખાતું ડિલીટ કરવું", body: "Settings → “Privacy & consents” (પ્રાઇવસી અને સંમતિઓ) માં તમે વૈકલ્પિક સંમતિઓ ગમે ત્યારે બંધ કરી શકો — જેટલી સરળતાથી આપી હતી એટલી જ સરળતાથી. Settings → “Disconnect broker” (બ્રોકર ડિસ્કનેક્ટ કરો) થી તમારી Groww key તરત દૂર થાય છે અને તમારી Groww સંમતિ પાછી ખેંચાયાની નોંધ થાય છે; તમે Groww પર પણ key રદ કરી શકો છો. Settings → “Delete account” (ખાતું ડિલીટ કરો) થી તમારું ખાતું અને વ્યક્તિગત ડેટા તરત ભૂંસાઈ જાય છે — બિલિંગ રેકોર્ડ અને સર્વર લૉગ સિવાય બધું, અમારા સૉફ્ટવેરની બેકઅપ નકલો સહિત (પહેલાં ચાલુ મેમ્બરશિપ છોડવી પડશે અને બાકી ઇનવૉઇસ ચૂકવવું પડશે). આ આવૃત્તિ પર સહી કરતાં કે Groww જોડતાં પહેલાં પણ Settings તમારા માટે ખુલ્લું રહે છે. તમે support@visionmarket.in પર પણ લખી શકો છો." },
    { heading: "13. માર્કેટિંગ, એનાલિટિક્સ અને કુકીઝ", body: "માર્કેટિંગ મેસેજ (ઈમેલ, SMS કે WhatsApp) અને બિન-જરૂરી એનાલિટિક્સ કે કુકીઝ વૈકલ્પિક અને અલગ છે, અને ફક્ત સંમતિ આપનાર માટે છે; એ નકારવાથી કે પાછી ખેંચવાથી મૂળ સેવા ક્યારેય મર્યાદિત થતી નથી. આજે અમે કોઈ માર્કેટિંગ મોકલતા નથી અને કોઈ એનાલિટિક્સ ટૂલ કે બિન-જરૂરી કુકી વાપરતા નથી — ફક્ત એક અનિવાર્ય સાઇન-ઇન કુકી (આઠ કલાક માટે માન્ય) અને તમારા બ્રાઉઝરમાં રખાયેલી થીમ સેટિંગ." },
    { heading: "14. તમારી સંમતિનો રેકોર્ડ", body: "અમે તમારી સંમતિનો પુરાવો રાખીએ છીએ: કરારની આવૃત્તિ અને એની ફિંગરપ્રિન્ટ, તમે જોયેલી દરેક ભાષા, તમે ટિક કરેલું દરેક બોક્સ, તમારી ટાઇપ કરેલી સહી, તારીખ અને સમય, તમારું IP સરનામું અને ડિવાઇસ, તમારી સેલ્ફી અને ID ફોટો, અને પછીનો કોઈ પણ ફેરફાર કે પાછી ખેંચેલી સંમતિ." },
    { heading: "15. સેવા, જવાબદારી, ફેરફાર અને કાયદો", body: "સેવા “જેમ છે તેમ”, વોરંટી વગર, કાયદો મંજૂરી આપે ત્યાં સુધી આપવામાં આવે છે; એમાં વિલંબ, વિક્ષેપ કે ખોટો ડેટા હોઈ શકે, એટલે મહત્ત્વની વાત હંમેશા તમારા બ્રોકર પર ચકાસો. MNHA ટ્રેડિંગ નુકસાન, ડાઉનટાઇમ કે ડેટા ભૂલ માટે જવાબદાર નથી. અમે આ કરાર બદલી શકીએ; મોટો ફેરફાર તમારી પાસે ફરી સ્વીકૃતિ માંગશે. આ ભારતના કાયદાને આધીન છે, જેમાં ડિજિટલ પર્સનલ ડેટા પ્રોટેક્શન એક્ટ, 2023 અને એના નિયમો સામેલ છે." },
    { heading: "16. પ્રશ્નો અને ફરિયાદો", body: "પ્રશ્નો, ડેટા વિનંતી કે ફરિયાદ માટે support@visionmarket.in પર લખો. અમે થોડા કામકાજના દિવસોમાં જવાબ આપવાનો પ્રયત્ન કરીએ છીએ. જ્યાં ડિજિટલ પર્સનલ ડેટા પ્રોટેક્શન એક્ટ લાગુ પડે, ત્યાં તમે ડેટા પ્રિન્સિપલને મળતા ઉપાયો પણ લઈ શકો છો, જેમાં ભારતના ડેટા પ્રોટેક્શન બોર્ડમાં ફરિયાદનો સમાવેશ થાય છે." },
  ],
  consents: [
    { key: "account", label: "ખાતું, શરતો અને પ્રાઇવસી", text: "હું MNHA Financials ખાતું બનાવવા અને આ કરાર — ઉપયોગની શરતો, પ્રાઇવસી પોલિસી અને જોખમ ડિસ્ક્લોઝર સહિત — સ્વીકારવા સંમત છું. હું સમજું છું કે મારો વ્યક્તિગત ડેટા ઉપર જણાવ્યા મુજબ પ્રોસેસ થશે." },
    { key: "identity", label: "ઓળખની ખરાઈ", text: "હું મારી ઓળખ ચકાસવા અને મારા ખાતાની સુરક્ષા માટે MNHA ને મારી સેલ્ફી અને ફોટો ID લેવા અને રાખવાની સંમતિ આપું છું, ઉપર જણાવ્યા મુજબ." },
    { key: "groww", label: "Groww કનેક્શન, ફક્ત વાંચવા માટે", text: "હું MNHA ને મારી Groww API key અને TOTP secret એન્ક્રિપ્ટેડ રાખવાની અને એનાથી ફક્ત મારો Groww ક્લાયન્ટ કોડ, બેલેન્સ, હોલ્ડિંગ્સ, પોઝિશન, ઓર્ડર બુક, ફિલ અને લાઇવ બજાર-ડેટા વાંચવાની સંમતિ આપું છું, જેથી મારું ડેસ્ક અને રાઉન્ડ-ટ્રિપ વિશ્લેષણ ચાલી શકે." },
    { key: "risk", label: "સ્થિતિ અને જોખમ", text: "હું સમજું છું કે MNHA બ્રોકર, રિસર્ચ એનાલિસ્ટ કે ઇન્વેસ્ટમેન્ટ એડવાઇઝર નથી, મને કોઈ સિક્યુરિટી ખરીદવા કે વેચવાની ભલામણ કરતું નથી, મારા માટે કોઈ ઓર્ડર મૂકતું નથી, અને ટ્રેડિંગથી મોટું નુકસાન થઈ શકે છે." },
    { key: "marketing", label: "માર્કેટિંગ", text: "હું ઈમેલ, SMS અને/અથવા WhatsApp દ્વારા MNHA ના વૈકલ્પિક માર્કેટિંગ મેસેજ મેળવવા સંમત છું. હું એ ગમે ત્યારે પાછી ખેંચી શકું છું, મૂળ સેવા ગુમાવ્યા વગર." },
    { key: "analytics", label: "એનાલિટિક્સ અને કુકીઝ", text: "હું વૈકલ્પિક એનાલિટિક્સ અને બિન-જરૂરી કુકીઝ માટે સંમત છું, જેથી MNHA સમજી શકે કે એની વેબસાઇટ અને સૉફ્ટવેર કેવી રીતે વપરાય છે. હું એ ગમે ત્યારે પાછી ખેંચી શકું છું, જરૂરી સુવિધાઓ ગુમાવ્યા વગર." },
  ],
  spokenAck:
    "હું આ મારી પોતાની મરજીથી સહી કરું છું. હું સમજું છું કે MNHA Financials મને ખરીદ-વેચાણની કોઈ ટિપ આપતું નથી અને મારા માટે કોઈ ઓર્ડર મૂકતું નથી, કે ટ્રેડિંગનો દરેક નિર્ણય મારી પોતાની જવાબદારી છે, કે ટ્રેડિંગ જોખમી છે અને મારા પૈસા ડૂબી શકે છે, અને કોઈ ગેરંટીડ રિટર્ન નથી. મેં આ કરાર વાંચ્યો અને સમજ્યો છે.",
  ui: {
    timeDone: "વાંચવાનો સમય પૂરો",
    uploading: "અપલોડ થાય છે…",
    uploadFailed: "અપલોડ ન થયું — કૃપા કરી ફરી પ્રયત્ન કરો.",
    signName: "સહી કરવા માટે તમારું પૂરું નામ લખો.",
    mediaStale: "આ સહી માટે કૃપા કરી તમારી સેલ્ફી અને ID ફોટો ફરી ઉમેરો.",
    before: "શરૂ કરતાં પહેલાં",
    subtitle: "આખો કરાર વાંચો કે સાંભળો, ફોન પર તમારી ઓળખ ચકાસો, સંમતિઓ આપો અને સહી કરો.",
    language: "ભાષા", listen: "સાંભળો", pause: "થોભો", playing: "વાંચી રહ્યું છે…", loadingAudio: "ઓડિયો તૈયાર થાય છે…",
    noVoice: "આ બ્રાઉઝરમાં આ ભાષાનો અવાજ નથી. આ પેજ Microsoft Edge માં, અથવા Android પર Chrome માં ખોલો — અથવા ઉપરનું લખાણ વાંચો.",
    readToEnd: "આગળ વધવા માટે છેક સુધી સ્ક્રોલ કરો", readDone: "છેક સુધી વાંચ્યું", listenDone: "કરાર સાંભળ્યો",
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
  media: { selfie: boolean; idPhoto: boolean; video: boolean };
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
    media: { selfie: boolean; idPhoto: boolean; video: boolean };
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

/** The user's consent for the current agreement version, if any. */
export async function currentConsent(userId: string): Promise<ConsentRecord | null> {
  const mine = (await read()).records.filter((r) => r.userId === userId && r.agreementVersion === AGREEMENT_VERSION);
  return mine.sort((a, b) => b.consentedAt - a.consentedAt)[0] ?? null;
}

/** Record a change to one consent on the current signed record (no-op if none).
 *  The signed set stays as signed; `current` and `changes` carry the change. */
export async function recordConsentChange(userId: string, key: ConsentKey, value: boolean): Promise<boolean> {
  return enqueue(async () => {
    const store = await readStrict();
    const mine = store.records
      .filter((r) => r.userId === userId && r.agreementVersion === AGREEMENT_VERSION)
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

export async function hasConsented(userId: string): Promise<boolean> {
  const v = AGREEMENT_VERSION;
  return (await read()).records.some((r) => r.userId === userId && r.agreementVersion === v);
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
