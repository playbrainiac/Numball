const SUPABASE_URL = 'https://mdybfpiwbfkidqjloadk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const EPOCH = new Date('2026-01-01');

function getDayNumber() {
  return Math.floor((Date.now() - EPOCH) / 86400000) + 1;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

async function questionsExistForDay(dayNumber) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/numball_questions?day_number=eq.${dayNumber}&select=id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return data && data.length > 0;
}

async function getAllPreviousQuestions() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/numball_questions?select=questions&order=day_number.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  if (!data || data.length === 0) return [];
  const all = [];
  data.forEach(row => {
    try {
      const qs = JSON.parse(row.questions);
      qs.forEach(q => all.push(q.q));
    } catch(e) {}
  });
  return all;
}

async function generateQuestions(dayNumber, previousQuestions) {
  const categories = ['Sports', 'Pop Culture', 'History', 'World Facts', 'Money', 'Science', 'Food & Drink', 'Music', 'Movies & TV', 'Geography', 'Nature', 'Technology', 'Literature', 'Art', 'Politics'];
  const picked = categories.sort(() => Math.random() - 0.5).slice(0, 5);

  const neverRepeat = previousQuestions.length > 0
    ? `\n\nNEVER repeat or closely paraphrase any of these ${previousQuestions.length} questions that have already been used:\n${previousQuestions.map((q, i) => `${i+1}. ${q}`).join('\n')}`
    : '';

  const prompt = `Generate exactly 5 brand new number trivia questions for a daily guessing game called NUMBALL. Each question must have a single definitive numerical answer.

Categories to use (one per question): ${picked.join(', ')}

Rules:
- Questions must have a single, verifiable numerical answer
- Answers should be interesting and surprising but not impossibly obscure
- Mix easy and hard questions
- Avoid questions where the answer is 0 or 1
- Make the questions fun and engaging
- Every question must be completely unique — never repeat a topic, subject, or answer that has been used before${neverRepeat}

Return ONLY a JSON array with exactly 5 objects, no other text:
[
  {"q": "question text here?", "a": 42, "cat": "Category"},
  ...
]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  console.log('Anthropic response status:', response.status);
  if (!data.content || !data.content[0]) {
    throw new Error('No content in Anthropic response: ' + JSON.stringify(data));
  }
  const text = data.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function saveQuestions(dayNumber, date, questions) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/numball_questions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      day_number: dayNumber,
      date: date,
      questions: JSON.stringify(questions),
    }),
  });
  return res.ok;
}

export default async function handler(req, res) {
  try {
    const dayNumber = getDayNumber();
    const date = getTodayDate();

    const exists = await questionsExistForDay(dayNumber);
    if (exists) {
      return res.status(200).json({ message: `Questions for day ${dayNumber} already exist` });
    }

    // Pull full history so Claude never repeats
    const previousQuestions = await getAllPreviousQuestions();
    console.log(`Generating questions for day ${dayNumber}, avoiding ${previousQuestions.length} previous questions`);

    const questions = await generateQuestions(dayNumber, previousQuestions);

    const saved = await saveQuestions(dayNumber, date, questions);
    if (!saved) {
      return res.status(500).json({ error: 'Failed to save questions to Supabase' });
    }

    return res.status(200).json({
      message: `Generated and saved questions for day ${dayNumber}`,
      questions,
    });
  } catch (err) {
    console.error('Error generating questions:', err);
    return res.status(500).json({ error: err.message });
  }
}
