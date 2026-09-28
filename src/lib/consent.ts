import "server-only";
import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * The MNHA user agreement — presented like a formal contract on a letterhead,
 * in English, Hindi and Gujarati, with audio and a spoken video acknowledgement.
 *
 * The English text is the canonical version that gets hashed into every consent
 * record (with the language the user actually read/heard). The record — server
 * timestamp, IP, user-agent, signature, media — is the artifact, not the timer.
 *
 * NOTE (kept deliberately): this agreement makes NO guaranteed-return or
 * loss-protection offer. Such a scheme is unlawful in India without SEBI
 * registration and is intentionally absent.
 */

export const AGREEMENT_VERSION = "2.0 · 2026-09-28";

export type Lang = "en" | "hi" | "gu";
export const LANGS: { code: Lang; label: string; ttsLang: string }[] = [
  { code: "en", label: "English", ttsLang: "en-IN" },
  { code: "hi", label: "हिन्दी", ttsLang: "hi-IN" },
  { code: "gu", label: "ગુજરાતી", ttsLang: "gu-IN" },
];

export interface Section { heading: string; body: string }
export interface ContractLang {
  title: string;
  org: { name: string; tagline: string; meta: string };
  intro: string;
  sections: Section[];
  spokenAck: string;
  ui: Record<string, string>;
}

const en: ContractLang = {
  title: "User Agreement & Risk Disclosure",
  org: { name: "MNHA FINANCIALS", tagline: "Simple trading. Intelligent alerts. Your control.", meta: `Agreement version ${AGREEMENT_VERSION}` },
  intro:
    "This is an agreement between you and MNHA Financials. Please read it in full — or listen to it — and sign at the end. You accept it once per version.",
  sections: [
    { heading: "1. What MNHA Financials is", body: "MNHA Financials is a technology service that connects to your own broker account and helps you see and understand your account and the market more easily. It is a tool for clarity and a better experience. It is NOT a broker, bank, portfolio manager or investment adviser, and it is not registered with SEBI as a Research Analyst or Investment Adviser. Your money and securities always remain in your own broker account." },
    { heading: "2. We do not give buy/sell tips", body: "MNHA Financials does not provide buy or sell tips, recommendations or investment advice. Any alert, signal, or AI/assistant feature is only a tool to help you understand information yourself. Whatever you decide or do based on anything you see here is entirely your own decision and your own responsibility. The platform is not responsible for your trades or their outcomes." },
    { heading: "3. The AI assistant and any bot feature", body: "Any AI assistant or automated feature exists to make the platform easier to use and understand. It does not tell you what to buy or sell. Acting on it is your choice, at your own risk; the platform accepts no responsibility for any decision made using it." },
    { heading: "4. Auto-trade is at your own risk", body: "If any auto-trade feature is available and you switch it on, any resulting profit is yours and any resulting loss is yours. You enable it of your own free will, and the platform is not responsible for any profit or loss from it. You can turn it off at any time." },
    { heading: "5. Trading is risky — no guarantee", body: "Trading in shares and derivatives carries real risk, including the loss of your entire capital; leveraged products can lose more than you put in. There is NO guaranteed return and NO protection against loss offered here, and any promise of guaranteed or zero-loss returns — from anyone — is false. Past performance does not predict the future." },
    { heading: "6. Your identity and data", body: "To verify who you are, you provide a selfie, a photo of your PAN/Aadhaar, and a short spoken video acknowledgement, along with basic details. Your PAN and date of birth are stored encrypted; your photos and video are kept private and are viewable only by you and the reviewer. You consent to this collection for identity verification and running the service, and you may delete everything from Settings at any time." },
    { heading: "7. Your orders, your control", body: "Every order is placed on your own broker account and needs your own confirmation. You are in control. The service may be delayed, interrupted, or show wrong data; always check your broker for anything important." },
    { heading: "8. Liability, changes, and law", body: "The service is provided “as is”, without warranties, to the extent allowed by law. MNHA Financials is not liable for trading losses, downtime or data errors. This agreement may be updated; a material change asks you to accept again. It is governed by the laws of India." },
  ],
  spokenAck:
    "I am signing this of my own free will, in a sound state of mind. I understand that MNHA Financials does not give me buy or sell tips, that any trade I make is my own decision and my own responsibility, that trading is risky and I can lose money, and that there is no guaranteed return. I have read and understood this agreement.",
  ui: {
    before: "Before you begin",
    subtitle: "Read or listen to the full agreement, verify your identity, and sign.",
    language: "Language",
    listen: "Listen",
    pause: "Pause",
    playing: "Reading aloud…",
    readToEnd: "Scroll to the end to continue",
    readDone: "Read to the end",
    listenDone: "Listened to the agreement",
    timeLeft: "Please take a moment",
    endOfAgreement: "— End of agreement —",
    identity: "Verify your identity",
    selfie: "Selfie (live photo)",
    idphoto: "PAN / Aadhaar photo",
    video: "Spoken acknowledgement (video)",
    videoHint: "Record yourself reading the sentence below aloud.",
    startRec: "Start recording",
    stopRec: "Stop",
    reRec: "Record again",
    agree: "I have read and understood this agreement, and I agree to it.",
    signature: "Digital signature — type your full name",
    signaturePh: "Your full name",
    submit: "Provide consent & sign",
    submitting: "Recording your consent…",
    auditNote: "Signing records your name, the exact agreement version, the language you chose, and the date, time, IP and device — as an audit trail. The timer and audio are good-faith aids, not a legal guarantee.",
    needMedia: "Please add your selfie, PAN/Aadhaar photo, and the spoken video first.",
  },
};

const hi: ContractLang = {
  title: "उपयोगकर्ता अनुबंध एवं जोखिम प्रकटीकरण",
  org: { name: "MNHA FINANCIALS", tagline: "आसान ट्रेडिंग। समझदार अलर्ट। आपका नियंत्रण।", meta: `अनुबंध संस्करण ${AGREEMENT_VERSION}` },
  intro: "यह आपके और MNHA Financials के बीच एक अनुबंध है। कृपया इसे पूरा पढ़ें — या सुनें — और अंत में हस्ताक्षर करें।",
  sections: [
    { heading: "1. MNHA Financials क्या है", body: "MNHA Financials एक तकनीकी सेवा है जो आपके अपने ब्रोकर खाते से जुड़ती है और आपको अपना खाता व बाज़ार आसानी से देखने-समझने में मदद करती है। यह एक टूल है। यह ब्रोकर, बैंक, पोर्टफोलियो मैनेजर या निवेश सलाहकार नहीं है, और SEBI में रजिस्टर्ड नहीं है। आपका पैसा और शेयर हमेशा आपके अपने ब्रोकर खाते में रहते हैं।" },
    { heading: "2. हम खरीद/बिक्री की टिप नहीं देते", body: "MNHA Financials कोई खरीद-बिक्री की टिप, सिफ़ारिश या निवेश सलाह नहीं देता। कोई भी अलर्ट, सिग्नल या AI फ़ीचर केवल आपकी समझ के लिए एक टूल है। यहाँ देखी गई किसी भी चीज़ के आधार पर आप जो निर्णय लेते हैं वह पूरी तरह आपका अपना निर्णय और आपकी अपनी ज़िम्मेदारी है।" },
    { heading: "3. AI असिस्टेंट और कोई भी बॉट फ़ीचर", body: "कोई भी AI असिस्टेंट या ऑटोमेटेड फ़ीचर प्लेटफ़ॉर्म को आसान बनाने के लिए है। यह नहीं बताता कि क्या खरीदें या बेचें। उस पर अमल करना आपकी पसंद है, आपके अपने जोखिम पर।" },
    { heading: "4. ऑटो-ट्रेड आपके अपने जोखिम पर", body: "यदि कोई ऑटो-ट्रेड फ़ीचर उपलब्ध हो और आप उसे चालू करें, तो होने वाला मुनाफ़ा आपका है और होने वाला नुकसान भी आपका है। आप इसे अपनी मर्ज़ी से चालू करते हैं; प्लेटफ़ॉर्म इसके किसी मुनाफ़े या नुकसान के लिए ज़िम्मेदार नहीं है।" },
    { heading: "5. ट्रेडिंग जोखिम भरी है — कोई गारंटी नहीं", body: "शेयर और डेरिवेटिव में ट्रेडिंग में वास्तविक जोखिम है, आपकी पूरी पूँजी डूब सकती है। यहाँ कोई गारंटीड रिटर्न या नुकसान से सुरक्षा नहीं दी जाती, और गारंटीड या ज़ीरो-लॉस रिटर्न का कोई भी वादा — किसी का भी — झूठा है। पिछला प्रदर्शन भविष्य की गारंटी नहीं है।" },
    { heading: "6. आपकी पहचान और डेटा", body: "पहचान सत्यापन के लिए आप एक सेल्फ़ी, PAN/आधार की फ़ोटो, और एक छोटा बोलकर किया गया वीडियो देते हैं। आपका PAN और जन्मतिथि एन्क्रिप्टेड रूप में रखे जाते हैं; आपकी फ़ोटो/वीडियो निजी रहते हैं। आप इस संग्रह के लिए सहमति देते हैं और सेटिंग्स से कभी भी सब कुछ हटा सकते हैं।" },
    { heading: "7. आपके ऑर्डर, आपका नियंत्रण", body: "हर ऑर्डर आपके अपने ब्रोकर खाते में, आपकी पुष्टि के साथ लगता है। नियंत्रण आपके पास है। सेवा में देरी या गड़बड़ी हो सकती है; ज़रूरी बात हमेशा अपने ब्रोकर पर जाँचें।" },
    { heading: "8. दायित्व, बदलाव और कानून", body: "सेवा “जैसी है वैसी” दी जाती है। MNHA Financials ट्रेडिंग नुकसान, डाउनटाइम या डेटा त्रुटि के लिए ज़िम्मेदार नहीं है। अनुबंध बदल सकता है; बड़ा बदलाव फिर से स्वीकृति माँगता है। यह भारत के कानूनों के अधीन है।" },
  ],
  spokenAck:
    "मैं यह अपनी मर्ज़ी से, पूरे होश-ओ-हवास में साइन कर रहा/रही हूँ। मैं समझता/समझती हूँ कि MNHA Financials मुझे खरीद-बिक्री की कोई टिप नहीं देता, कि मैं जो भी ट्रेड करूँ वह मेरा अपना निर्णय और मेरी ज़िम्मेदारी है, कि ट्रेडिंग जोखिम भरी है और मेरा पैसा डूब सकता है, और कोई गारंटीड रिटर्न नहीं है। मैंने यह अनुबंध पढ़ और समझ लिया है।",
  ui: {
    before: "शुरू करने से पहले", subtitle: "पूरा अनुबंध पढ़ें या सुनें, अपनी पहचान सत्यापित करें, और साइन करें।",
    language: "भाषा", listen: "सुनें", pause: "रोकें", playing: "पढ़ा जा रहा है…",
    readToEnd: "जारी रखने के लिए अंत तक स्क्रॉल करें", readDone: "अंत तक पढ़ लिया", listenDone: "अनुबंध सुन लिया",
    timeLeft: "कृपया एक पल रुकें", endOfAgreement: "— अनुबंध समाप्त —",
    identity: "अपनी पहचान सत्यापित करें", selfie: "सेल्फ़ी (लाइव फ़ोटो)", idphoto: "PAN / आधार फ़ोटो",
    video: "बोलकर स्वीकृति (वीडियो)", videoHint: "नीचे दिया वाक्य बोलते हुए अपना वीडियो रिकॉर्ड करें।",
    startRec: "रिकॉर्डिंग शुरू करें", stopRec: "रोकें", reRec: "फिर से रिकॉर्ड करें",
    agree: "मैंने यह अनुबंध पढ़ और समझ लिया है, और मैं इससे सहमत हूँ।",
    signature: "डिजिटल हस्ताक्षर — अपना पूरा नाम लिखें", signaturePh: "आपका पूरा नाम",
    submit: "सहमति दें और साइन करें", submitting: "आपकी सहमति दर्ज हो रही है…",
    auditNote: "साइन करने पर आपका नाम, अनुबंध संस्करण, चुनी गई भाषा, तथा दिनांक, समय, IP और डिवाइस दर्ज होते हैं। टाइमर और ऑडियो सहायक हैं, कानूनी गारंटी नहीं।",
    needMedia: "कृपया पहले अपनी सेल्फ़ी, PAN/आधार फ़ोटो और वीडियो जोड़ें।",
  },
};

const gu: ContractLang = {
  title: "વપરાશકર્તા કરાર અને જોખમ ડિસ્ક્લોઝર",
  org: { name: "MNHA FINANCIALS", tagline: "સરળ ટ્રેડિંગ. સ્માર્ટ અલર્ટ. તમારું નિયંત્રણ.", meta: `કરાર આવૃત્તિ ${AGREEMENT_VERSION}` },
  intro: "આ તમારા અને MNHA Financials વચ્ચેનો કરાર છે. કૃપા કરીને એને પૂરો વાંચો — અથવા સાંભળો — અને છેલ્લે સહી કરો.",
  sections: [
    { heading: "1. MNHA Financials શું છે", body: "MNHA Financials એક ટેકનોલોજી સેવા છે જે તમારા પોતાના બ્રોકર ખાતા સાથે જોડાય છે અને તમને તમારું ખાતું અને બજાર સરળતાથી જોવા-સમજવામાં મદદ કરે છે. આ એક ટૂલ છે. આ બ્રોકર, બેંક, પોર્ટફોલિયો મેનેજર કે ઇન્વેસ્ટમેન્ટ એડવાઇઝર નથી, અને SEBI માં રજિસ્ટર્ડ નથી. તમારા પૈસા અને શેર હંમેશા તમારા પોતાના બ્રોકર ખાતામાં જ રહે છે." },
    { heading: "2. અમે ખરીદ/વેચાણની ટિપ આપતા નથી", body: "MNHA Financials કોઈ ખરીદ-વેચાણની ટિપ, ભલામણ કે ઇન્વેસ્ટમેન્ટ સલાહ આપતું નથી. કોઈ પણ અલર્ટ, સિગ્નલ કે AI ફીચર ફક્ત તમારી સમજ માટે એક ટૂલ છે. અહીં જોયેલ કોઈ પણ વસ્તુના આધારે તમે જે નિર્ણય લો એ સંપૂર્ણપણે તમારો પોતાનો નિર્ણય અને તમારી પોતાની જવાબદારી છે." },
    { heading: "3. AI આસિસ્ટન્ટ અને કોઈ પણ બોટ ફીચર", body: "કોઈ પણ AI આસિસ્ટન્ટ કે ઓટોમેટેડ ફીચર પ્લેટફોર્મ સરળ બનાવવા માટે છે. એ શું ખરીદવું-વેચવું એ કહેતું નથી. એના પર અમલ કરવો એ તમારી પસંદ છે, તમારા પોતાના જોખમે." },
    { heading: "4. ઓટો-ટ્રેડ તમારા પોતાના જોખમે", body: "જો કોઈ ઓટો-ટ્રેડ ફીચર ઉપલબ્ધ હોય અને તમે એ ચાલુ કરો, તો થતો નફો તમારો છે અને થતું નુકસાન પણ તમારું છે. તમે એ તમારી મરજીથી ચાલુ કરો છો; પ્લેટફોર્મ એના કોઈ નફા કે નુકસાન માટે જવાબદાર નથી." },
    { heading: "5. ટ્રેડિંગ જોખમી છે — કોઈ ગેરંટી નહીં", body: "શેર અને ડેરિવેટિવ્સમાં ટ્રેડિંગમાં ખરું જોખમ છે, તમારી આખી મૂડી ડૂબી શકે છે. અહીં કોઈ ગેરંટીડ રિટર્ન કે નુકસાનથી રક્ષણ આપવામાં આવતું નથી, અને ગેરંટીડ કે ઝીરો-લોસ રિટર્નનું કોઈ પણ વચન — કોઈનું પણ — ખોટું છે. ભૂતકાળનું પ્રદર્શન ભવિષ્યની ગેરંટી નથી." },
    { heading: "6. તમારી ઓળખ અને ડેટા", body: "ઓળખની ખરાઈ માટે તમે એક સેલ્ફી, PAN/આધારનો ફોટો, અને એક ટૂંકો બોલીને કરેલો વીડિયો આપો છો. તમારો PAN અને જન્મતારીખ એન્ક્રિપ્ટેડ રાખવામાં આવે છે; તમારા ફોટા/વીડિયો ખાનગી રહે છે. તમે આ સંગ્રહ માટે સંમતિ આપો છો અને સેટિંગ્સમાંથી ગમે ત્યારે બધું ડિલીટ કરી શકો છો." },
    { heading: "7. તમારા ઓર્ડર, તમારું નિયંત્રણ", body: "દરેક ઓર્ડર તમારા પોતાના બ્રોકર ખાતામાં, તમારી પુષ્ટિ સાથે મુકાય છે. નિયંત્રણ તમારી પાસે છે. સેવામાં વિલંબ કે ભૂલ થઈ શકે; મહત્ત્વની વાત હંમેશા તમારા બ્રોકર પર ચકાસો." },
    { heading: "8. જવાબદારી, ફેરફાર અને કાયદો", body: "સેવા “જેમ છે તેમ” આપવામાં આવે છે. MNHA Financials ટ્રેડિંગ નુકસાન, ડાઉનટાઇમ કે ડેટા ભૂલ માટે જવાબદાર નથી. કરાર બદલાઈ શકે; મોટો ફેરફાર ફરી સંમતિ માંગે છે. આ ભારતના કાયદાને આધીન છે." },
  ],
  spokenAck:
    "હું આ મારી પોતાની મરજીથી, પૂરા હોશ-હવાસમાં સહી કરું છું. હું સમજું છું કે MNHA Financials મને ખરીદ-વેચાણની કોઈ ટિપ આપતું નથી, કે હું જે પણ ટ્રેડ કરું એ મારો પોતાનો નિર્ણય અને મારી જવાબદારી છે, કે ટ્રેડિંગ જોખમી છે અને મારા પૈસા ડૂબી શકે છે, અને કોઈ ગેરંટીડ રિટર્ન નથી. મેં આ કરાર વાંચ્યો અને સમજ્યો છે.",
  ui: {
    before: "શરૂ કરતાં પહેલાં", subtitle: "આખો કરાર વાંચો કે સાંભળો, તમારી ઓળખ ચકાસો, અને સહી કરો.",
    language: "ભાષા", listen: "સાંભળો", pause: "થોભો", playing: "વાંચી રહ્યું છે…",
    readToEnd: "આગળ વધવા માટે છેક સુધી સ્ક્રોલ કરો", readDone: "છેક સુધી વાંચ્યું", listenDone: "કરાર સાંભળ્યો",
    timeLeft: "કૃપા કરી એક ક્ષણ થોભો", endOfAgreement: "— કરાર સમાપ્ત —",
    identity: "તમારી ઓળખ ચકાસો", selfie: "સેલ્ફી (લાઇવ ફોટો)", idphoto: "PAN / આધાર ફોટો",
    video: "બોલીને સંમતિ (વીડિયો)", videoHint: "નીચેનું વાક્ય બોલતાં તમારો વીડિયો રેકોર્ડ કરો.",
    startRec: "રેકોર્ડિંગ શરૂ કરો", stopRec: "થોભો", reRec: "ફરી રેકોર્ડ કરો",
    agree: "મેં આ કરાર વાંચ્યો અને સમજ્યો છે, અને હું એની સાથે સંમત છું.",
    signature: "ડિજિટલ સહી — તમારું પૂરું નામ લખો", signaturePh: "તમારું પૂરું નામ",
    submit: "સંમતિ આપો અને સહી કરો", submitting: "તમારી સંમતિ નોંધાઈ રહી છે…",
    auditNote: "સહી કરવાથી તમારું નામ, કરાર આવૃત્તિ, પસંદ કરેલી ભાષા, અને તારીખ, સમય, IP અને ડિવાઇસ નોંધાય છે. ટાઇમર અને ઓડિયો સહાયક છે, કાનૂની ગેરંટી નથી.",
    needMedia: "કૃપા કરી પહેલાં તમારી સેલ્ફી, PAN/આધાર ફોટો અને વીડિયો ઉમેરો.",
  },
};

export const CONTRACT: Record<Lang, ContractLang> = { en, hi, gu };

/** Canonical (English) plaintext — what gets hashed. */
export function agreementPlainText(): string {
  return (
    `${en.org.name} — ${en.title}\nVersion ${AGREEMENT_VERSION}\n\n` +
    en.sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n") +
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
async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  try { await copyFile(FILE, `${FILE}.bak`); } catch { /* first write */ }
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

export async function recordConsent(
  userId: string,
  input: { signatureName: string; language: Lang; ip: string; userAgent: string; media: { selfie: boolean; idPhoto: boolean; video: boolean } },
): Promise<void> {
  return enqueue(async () => {
    const store = await read();
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
    });
    await write(store);
  });
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
    const store = await read();
    const before = store.records.length;
    store.records = store.records.filter((r) => r.userId !== userId);
    if (store.records.length !== before) await write(store);
  });
}
