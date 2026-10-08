import { DIFFICULTIES, QUESTIONS_URL } from './config.js';

// ---------------------------------------------------------------------------
// Hardcoded bank: only used if data/questions.json fails to load. Limited to
// the sanctioned OpenTDB categories and labelled with their OpenTDB names.
// ---------------------------------------------------------------------------
const FALLBACK = {
  easy: [
    ['Science & Nature', 'What is the largest planet in our solar system?', 'Jupiter', ['Saturn', 'Neptune', 'Earth']],
    ['Animals', 'How many legs does a spider have?', '8', ['6', '10', '12']],
    ['History', 'Which city is home to the Liberty Bell?', 'Philadelphia', ['Boston', 'New York', 'Washington, D.C.']],
    ['Geography', 'Which is the longest river in Africa?', 'Nile', ['Congo', 'Niger', 'Zambezi']],
    ['Geography', 'Which is the largest ocean on Earth?', 'Pacific', ['Atlantic', 'Indian', 'Arctic']],
    ['Science & Nature', 'Which gas do plants absorb from the air for photosynthesis?', 'Carbon dioxide', ['Oxygen', 'Nitrogen', 'Helium']],
  ],
  medium: [
    ['History', 'In what year was the U.S. Declaration of Independence adopted?', '1776', ['1789', '1765', '1812']],
    ['Science & Nature', 'What is the chemical symbol for gold?', 'Au', ['Ag', 'Gd', 'Go']],
    ['Science: Computers', 'What does "CPU" stand for?', 'Central Processing Unit', ['Computer Personal Unit', 'Central Program Utility', 'Core Processing Unit']],
    ['Geography', 'What is the capital of Australia?', 'Canberra', ['Sydney', 'Melbourne', 'Perth']],
    ['Science & Nature', 'How many bones are in the typical adult human body?', '206', ['186', '212', '250']],
    ['Science & Nature', 'Which element has the atomic number 1?', 'Hydrogen', ['Helium', 'Oxygen', 'Carbon']],
  ],
  hard: [
    ['History', "Philadelphia's Elfreth's Alley is famous for being what?", "One of America's oldest continuously inhabited residential streets", ['The first paved street in the U.S.', 'The shortest street in the U.S.', 'The site of the first U.S. mint']],
    ['Science: Mathematics', 'What is the smallest prime number greater than 100?', '101', ['103', '107', '109']],
    ['History', 'In which year did the Berlin Wall fall?', '1989', ['1991', '1987', '1985']],
    ['Science & Nature', 'What is the SI unit of electrical capacitance?', 'Farad', ['Henry', 'Tesla', 'Weber']],
    ['Politics', 'How many amendments does the U.S. Constitution have?', '27', ['26', '25', '28']],
    ['Science & Nature', 'What is the longest bone in the human body?', 'Femur', ['Tibia', 'Humerus', 'Fibula']],
  ],
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// OpenTDB category names → ids, for the built-in bank (which stores names).
const CATEGORY_IDS = {
  'General Knowledge': 9, 'Science & Nature': 17, 'Science: Computers': 18,
  'Science: Mathematics': 19, 'Geography': 22, 'History': 23, 'Animals': 27,
};

function makeQuestion({ id = null, categoryId, category, text, correct, incorrect, difficulty, source }) {
  return {
    id,
    categoryId: categoryId ?? CATEGORY_IDS[category] ?? null,
    category,
    text,
    correct,
    incorrect,
    difficulty,
    source,
    answers: shuffle([correct, ...incorrect]),
  };
}

// ---------------------------------------------------------------------------
// "Seen" memory: ids already shown on this device, per difficulty, so no
// question repeats until its difficulty's whole deck has been dealt.
// ---------------------------------------------------------------------------
const SEEN_KEY = 'tbs.seen.v2'; // v2: ids from the vetted pool (v1 held the old pool's ids)
try { localStorage.removeItem('tbs.seen.v1'); } catch {}

function loadSeen() {
  try {
    const s = JSON.parse(localStorage.getItem(SEEN_KEY));
    if (s) return Object.fromEntries(DIFFICULTIES.map((d) => [d, new Set(s[d] ?? [])]));
  } catch {}
  return Object.fromEntries(DIFFICULTIES.map((d) => [d, new Set()]));
}

function saveSeen(seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(DIFFICULTIES.map((d) => [d, [...seen[d]]]))));
  } catch {}
}

// ---------------------------------------------------------------------------
// Question bank: the hand-vetted pool in data/easy_trivia_pool_vetted.json
// (OpenTDB schema, text already entity-decoded). Records are normalized to
// { id, category, difficulty, question, correct, incorrect }.
// ---------------------------------------------------------------------------
function normalize(q) {
  return {
    id: String(q.id), // also the key api/explain looks the question up by
    categoryId: q.category_id,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    correct: q.correct_answer,
    incorrect: q.incorrect_answers,
  };
}

class QuestionBank {
  constructor() {
    this.buckets = { easy: [], medium: [], hard: [] };
    this.seen = loadSeen();
    this.spare = Object.fromEntries(DIFFICULTIES.map((d) => [d, shuffle(FALLBACK[d])]));
    this.status = 'loading'; // 'loading' | 'ready' | 'fallback'
  }

  async load() {
    try {
      const res = await fetch(QUESTIONS_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { questions } = await res.json();
      for (const q of questions.map(normalize)) this.buckets[q.difficulty]?.push(q);
      this.status = 'ready';
    } catch (err) {
      console.warn('[questions] could not load question file, using fallback bank', err);
      this.status = 'fallback';
    }
    return this;
  }

  // Return a dealt-but-never-shown question to its deck.
  putBack(q) {
    if (q.id && this.seen[q.difficulty].delete(q.id)) saveSeen(this.seen);
  }

  // Difficulties rounds can be dealt from: the ones the loaded pool has
  // questions for (only Easy with the vetted pool). Before the file loads, or
  // if it fails, the built-in bank covers all three.
  availableDifficulties() {
    const loaded = DIFFICULTIES.filter((d) => this.buckets[d].length);
    return loaded.length ? loaded : DIFFICULTIES;
  }

  // Unseen questions left in a difficulty's deck (for the debug panel).
  remaining(difficulty) {
    return this.buckets[difficulty].filter((q) => !this.seen[difficulty].has(q.id)).length;
  }

  take(difficulty) {
    const deck = this.buckets[difficulty];
    if (!deck.length) return this.takeFallback(difficulty);

    let unseen = deck.filter((q) => !this.seen[difficulty].has(q.id));
    if (!unseen.length) {
      // Whole deck dealt: start it over.
      this.seen[difficulty].clear();
      unseen = deck;
    }
    const q = unseen[Math.floor(Math.random() * unseen.length)];
    this.seen[difficulty].add(q.id);
    saveSeen(this.seen);
    return makeQuestion({
      id: q.id, // also the key for the AI explanation (api/explain + caches)
      categoryId: q.categoryId,
      category: q.category,
      text: q.question,
      correct: q.correct,
      incorrect: q.incorrect,
      difficulty,
      source: 'bank',
    });
  }

  takeFallback(difficulty) {
    if (this.spare[difficulty].length === 0) this.spare[difficulty] = shuffle(FALLBACK[difficulty]);
    const [category, text, correct, incorrect] = this.spare[difficulty].shift();
    return makeQuestion({ category, text, correct, incorrect, difficulty, source: 'fallback' });
  }
}

export function loadQuestionBank() {
  const bank = new QuestionBank();
  bank.ready = bank.load(); // resolves (never rejects) once the file is in or the fallback is set
  return bank;
}
