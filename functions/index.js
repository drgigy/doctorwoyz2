const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const db = getFirestore();

const REPORT_FIELDS = [
  "patientName",
  "patientAge",
  "patientSex",
  "patientUhid",
  "presentingComplaint",
  "historyOfPresentIllness",
  "pastMedicalHistory",
  "allergies",
  "familyHistory",
  "personalHistory",
  "examinationFindings",
  "currentMedication",
  "provisionalDiagnosis",
  "treatmentPlan"
];

const REPORT_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    REPORT_FIELDS.map(field => [field, { type: "string" }])
  ),
  required: REPORT_FIELDS,
  additionalProperties: false
};

function buildPrompt(strict) {
  return `
You are an expert neurology OPD medical scribe. Convert the recorded Malayalam,
English, or Kerala Manglish consultation into professional clinical English.

Accuracy rules:
- Return only the requested JSON object.
- Write every value only in English using Latin letters, numbers, and standard
  punctuation. Translate Malayalam clinical content and transliterate names.
- Preserve chronology, onset, duration, progression, relevant negatives,
  medicines with dose/frequency/duration, investigations, examination,
  diagnoses, and advice exactly as spoken.
- Never invent, infer, assume, recommend, or complete missing information.
- Distinguish patient statements, old diagnoses, possibilities discussed,
  examination findings, and the doctor's final assessment.
- Fill patientName, patientAge, patientSex, and patientUhid only when each is
  explicitly dictated. Otherwise use "NIL". Preserve the UHID exactly.
- Fill provisionalDiagnosis only if the doctor explicitly dictates the
  provisional diagnosis. Do not derive it from the conversation.
- Fill treatmentPlan only if the doctor explicitly dictates the final plan,
  prescription, investigation, referral, advice, or follow-up.
- Put medicines already being taken in currentMedication. Put newly prescribed
  medicines in treatmentPlan.
- Use "NIL" for every section that was not mentioned.
- Dictation style: ${strict ? "Stay very close to the spoken wording." : "Use polished clinical prose without adding information."}

Clinical glossary (spoken expression -> output):
തല ചുറ്റൽ -> Vertigo; തലകറക്കം/thala karangunnu -> Dizziness;
മരവിപ്പ് -> Numbness; കൈയ്ക്ക് ബലം കുറവ് -> Upper limb weakness;
കാലിന് ബലം കുറവ്/leg weakness undu -> Lower limb weakness;
കൈകാലുകൾക്ക് ബലം കുറവ് -> Limb weakness;
വാക്ക് കുഴയൽ/speech clear alla -> Dysarthria or slurring of speech;
സംസാരിക്കാൻ പറ്റിയില്ല -> Aphasia;
ഓർമ്മക്കുറവ്/മറവി/memory kuravaanu -> Memory impairment;
കാഴ്ച മങ്ങൽ -> Blurring of vision; ഇരട്ട കാഴ്ച -> Diplopia;
വിഴുങ്ങാൻ ബുദ്ധിമുട്ട് -> Dysphagia;
നടക്കാൻ ബുദ്ധിമുട്ട് -> Gait difficulty;
ബാലൻസ് പോകുന്നു/balance pokunnu -> Imbalance;
കൈ വിറയ്ക്കുന്നു -> Tremor;
ശരീരം മുറുകുന്നു/body stiff aakunnu -> Stiffness;
മുഖം കോടി പോകുക/മുഖം വലിഞ്ഞു/വായ കോണൽ -> Facial deviation or facial droop;
ഒരു വശം തളർന്നു -> Hemiparesis;
ഒരു വശം മരവിച്ചു -> Hemisensory symptoms;
പെട്ടെന്ന് വീണു -> Sudden collapse;
ബോധം പോയി -> Loss of consciousness or awareness;
ബോധം കുറഞ്ഞു -> Altered sensorium;
ഫിറ്റ്സ്/fit vannu -> Seizure;
കൈകാലുകൾ വെട്ടി -> Generalized tonic-clonic seizure;
കണ്ണ് മുകളിലേക്ക് പോയി -> Upward eye deviation;
വായിൽ നുര വന്നു -> Frothing;
നാക്ക് കടിച്ചു -> Tongue bite;
മൂത്രം പോയി -> Urinary incontinence;
ഞെട്ടൽ പോലെ -> Jerking movements;
നടക്കാൻ മന്ദം -> Bradykinesia;
ചെറിയ ചുവടുകൾ -> Shuffling gait;
തലയുടെ ഒരു വശത്ത് വേദന -> Unilateral headache;
വെളിച്ചം സഹിക്കാൻ പറ്റുന്നില്ല -> Photophobia;
ശബ്ദം സഹിക്കാൻ പറ്റുന്നില്ല -> Phonophobia;
ഛർദ്ദി വരുന്നു -> Nausea; ഛർദ്ദി ഉണ്ട് -> Vomiting;
കൂടിക്കൊണ്ടിരിക്കുകയാണ് -> Progressive symptoms;
കുറവുണ്ട് -> Improvement noted;
മാറ്റമില്ല -> No significant change;
പ്രമേഹം -> Diabetes mellitus; പ്രഷർ -> Hypertension;
കൊളസ്ട്രോൾ -> Dyslipidemia; തൈറോയ്ഡ് -> Thyroid disorder;
ബ്രെയിൻ ബ്ലോക്ക് -> Cerebral infarction;
രക്തസ്രാവം -> Intracranial hemorrhage.
`.trim();
}

function extractReport(payload) {
  const text = payload.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("The AI returned an empty response.");

  const parsed = JSON.parse(text);
  return Object.fromEntries(
    REPORT_FIELDS.map(field => [
      field,
      typeof parsed[field] === "string" && parsed[field].trim()
        ? parsed[field].trim()
        : "NIL"
    ])
  );
}

async function callGemini({ model, audioBase64, mimeType, strict }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey.value()
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: buildPrompt(strict) },
            {
              inline_data: {
                mime_type: mimeType,
                data: audioBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0,
          thinkingConfig: {
            thinkingBudget: 1024
          },
          responseMimeType: "application/json",
          responseSchema: REPORT_SCHEMA
        }
      })
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Gemini processing failed.");
    error.status = response.status;
    throw error;
  }

  return extractReport(payload);
}

exports.generateVisitNote = onCall(
  {
    region: "asia-south1",
    secrets: [geminiApiKey],
    timeoutSeconds: 540,
    memory: "1GiB",
    maxInstances: 5
  },
  async request => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    const device = await db.collection("devices").doc(request.auth.uid).get();
    if (!device.exists || device.data()?.status !== "approved") {
      throw new HttpsError(
        "permission-denied",
        "This device has not been approved."
      );
    }

    const audioBase64 = request.data?.audioBase64;
    const mimeType = request.data?.mimeType;
    const strict = request.data?.strict === true;

    if (typeof audioBase64 !== "string" || !audioBase64.length) {
      throw new HttpsError("invalid-argument", "The recording is empty.");
    }
    if (audioBase64.length > 28_000_000) {
      throw new HttpsError(
        "invalid-argument",
        "The recording is too large. Please make a shorter recording."
      );
    }
    if (typeof mimeType !== "string" || !mimeType.startsWith("audio/")) {
      throw new HttpsError("invalid-argument", "Unsupported recording format.");
    }

    const models = ["gemini-3.5-flash", "gemini-2.5-flash"];
    const errors = [];

    for (const model of models) {
      try {
        const report = await callGemini({
          model,
          audioBase64,
          mimeType,
          strict
        });
        return { report, model };
      } catch (error) {
        errors.push(error.message);
        const retryable =
          error.status === 429 ||
          error.status === 503 ||
          /high demand|overload|temporar|try again/i.test(error.message);
        if (!retryable) break;
      }
    }

    console.error("Visit note generation failed:", errors);
    throw new HttpsError(
      "internal",
      "The visit note could not be generated. Please try again."
    );
  }
);
