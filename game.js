import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- FIREBASE CONFIG (REPLACE WITH YOURS) ---
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- GAME STATE ---
let credits = 100;
let lastSavedCredits = 100;
let inputCost = 10;

const materials = [
    { char: "Fe", weight: 45, yield: 20 },   // common
    { char: "Cu", weight: 30, yield: 30 },
    { char: "Ag", weight: 15, yield: 70 },
    { char: "Au", weight: 7,  yield: 200 },
    { char: "Xe", weight: 2,  yield: 500 },  // rare
    { char: "Q*", weight: 1,  yield: 1500 }  // ultra rare
];
const totalWeight = materials.reduce((s, x) => s + x.weight, 0);

const shells = [
    { id: "default", name: "Standard Shell", cost: 0, className: "shell-default" },
    { id: "gold",    name: "Auric Shell",    cost: 2000, className: "shell-gold" },
    { id: "void",    name: "Void Shell",     cost: 5000, className: "shell-void" }
];
let ownedShells = ["default"];
let currentShellId = "default";

// Chemistry questions (in‑memory; admin can add more)
let chemQuestions = [
    { q: "What is the chemical symbol for Sodium?", a: "Na" },
    { q: "How many protons does Carbon have?", a: "6" },
    { q: "What is the chemical symbol for Potassium?", a: "K" },
    { q: "What is the pH of pure water at 25°C?", a: "7" },
    { q: "What is the chemical symbol for Iron?", a: "Fe" }
];
let currentChemIndex = null;

// --- AUTH FUNCTIONS (EXPOSED TO WINDOW) ---
window.login = async function() {
    const email = document.getElementById("emailInput").value;
    const pass = document.getElementById("passwordInput").value;
    const msg = document.getElementById("authMessage");
    try {
        await signInWithEmailAndPassword(auth, email, pass);
        msg.textContent = "Logged in.";
    } catch (err) {
        msg.textContent = err.message;
    }
};

window.signup = async function() {
    const email = document.getElementById("emailInput").value;
    const pass = document.getElementById("passwordInput").value;
    const msg = document.getElementById("authMessage");
    try {
        await createUserWithEmailAndPassword(auth, email, pass);
        msg.textContent = "Account created. You are now logged in.";
    } catch (err) {
        msg.textContent = err.message;
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById("authScreen").style.display = "none";
        document.getElementById("gameContainer").style.display = "block";
        document.getElementById("welcomeText").textContent =
            "Operator: " + (user.email || "Unknown");
        await loadProgress(user.uid);
        renderShells();
        await loadLeaderboard();
    } else {
        document.getElementById("authScreen").style.display = "block";
        document.getElementById("gameContainer").style.display = "none";
    }
});

// --- SAVE / LOAD ---
async function saveProgress(uid) {
    // basic anti‑cheat: clamp credits and ignore absurd jumps
    if (!Number.isFinite(credits)) credits = 0;
    if (credits < -1000000) credits = -1000000;
    if (credits > 1000000000) credits = 1000000000;

    const delta = credits - lastSavedCredits;
    if (Math.abs(delta) > 500000) {
        // suspicious jump, revert
        credits = lastSavedCredits;
    }

    lastSavedCredits = credits;

    await setDoc(doc(db, "operators", uid), {
        email: auth.currentUser?.email || "unknown",
        credits: credits,
        ownedShells: ownedShells,
        currentShellId: currentShellId,
        updatedAt: Date.now()
    });
    await loadLeaderboard();
}

async function loadProgress(uid) {
    const snap = await getDoc(doc(db, "operators", uid));
    if (snap.exists()) {
        const data = snap.data();
        credits = typeof data.credits === "number" ? data.credits : 100;
        lastSavedCredits = credits;

        if (Array.isArray(data.ownedShells)) {
            ownedShells = data.ownedShells;
        } else {
            ownedShells = ["default"];
        }

        if (typeof data.currentShellId === "string") {
            currentShellId = data.currentShellId;
        } else {
            currentShellId = "default";
        }
    } else {
        credits = 100;
        lastSavedCredits = 100;
        ownedShells = ["default"];
        currentShellId = "default";
        await saveProgress(uid);
    }
    updateCredits();
    applyShell(currentShellId);
}

async function loadLeaderboard() {
    const q = query(
        collection(db, "operators"),
        orderBy("credits", "desc"),
        limit(10)
    );
    const snap = await getDocs(q);
    const list = document.getElementById("leaderboardList");
    list.innerHTML = "";
    let rank = 1;
    snap.forEach(docSnap => {
        const data = docSnap.data();
        const li = document.createElement("li");
        const name = data.email || "Operator";
        const cVal = typeof data.credits === "number" ? data.credits : 0;
        li.innerHTML = `<span class="name">${rank}. ${name}</span><span>${cVal}</span>`;
        list.appendChild(li);
        rank++;
    });
}

function saveNow() {
    if (auth.currentUser) {
        saveProgress(auth.currentUser.uid);
    }
}

// --- UI HELPERS ---
function updateCredits() {
    document.getElementById("moneyValue").textContent = credits;
}

function setFabricatorMessage(text, isWin) {
    const el = document.getElementById("fabricatorMessage");
    el.textContent = text;
    el.className = isWin ? "winText" : "loseText";
}

function weightedRandomMaterial() {
    let r = Math.random() * totalWeight;
    for (const m of materials) {
        if (r < m.weight) return m;
        r -= m.weight;
    }
    return materials[0];
}

// --- INPUT COST CONTROLS ---
window.setInputCost = function(amount) {
    inputCost = amount;
    document.getElementById("inputAmount").textContent = inputCost;
};

// --- SHELLS ---
function applyShell(id) {
    const shell = shells.find(s => s.id === id) || shells[0];
    currentShellId = shell.id;
    const fab = document.getElementById("fabricator");
    fab.className = shell.className;
}

function renderShells() {
    const list = document.getElementById("shellList");
    list.innerHTML = "";
    shells.forEach(shell => {
        const btn = document.createElement("button");
        const owned = ownedShells.includes(shell.id);
        const equipped = currentShellId === shell.id;

        let label = `${shell.name} - ${shell.cost} credits`;
        if (shell.cost === 0) label = `${shell.name} (Default)`;
        if (owned) label += " [Owned]";
        if (equipped) label += " [Equipped]";

        btn.textContent = label;

        btn.onclick = () => {
            if (!owned) {
                if (credits < shell.cost) {
                    alert("Insufficient credits for this shell.");
                    return;
                }
                credits -= shell.cost;
                ownedShells.push(shell.id);
                updateCredits();
                saveNow();
            }
            applyShell(shell.id);
            saveNow();
            renderShells();
        };

        list.appendChild(btn);
    });
}

// --- ULTRA OUTPUT ANIMATION ---
function triggerUltraOutput() {
    const overlay = document.getElementById("ultraOverlay");
    overlay.style.display = "flex";
    setTimeout(() => {
        overlay.style.display = "none";
    }, 1200);
}

// --- FABRICATOR LOGIC ---
window.cycleFabricator = function() {
    if (credits < inputCost) {
        setFabricatorMessage("Insufficient credits. Report to chemistry shift.", false);
        return;
    }

    credits -= inputCost;
    updateCredits();
    saveNow();

    const m1 = weightedRandomMaterial();
    const m2 = weightedRandomMaterial();
    const m3 = weightedRandomMaterial();

    const reelEls = [
        document.getElementById("reel1"),
        document.getElementById("reel2"),
        document.getElementById("reel3")
    ];

    [m1, m2, m3].forEach((m, i) => {
        reelEls[i].classList.remove("spin");
        void reelEls[i].offsetWidth;
        reelEls[i].classList.add("spin");
        reelEls[i].textContent = m.char;
    });

    let yieldAmount = 0;
    let ultra = false;

    if (m1.char === m2.char && m2.char === m3.char) {
        yieldAmount = m1.yield * (inputCost / 10);
        if (m1.char === "Q*") {
            ultra = true;
        }
    } else if (m1.char === m2.char || m2.char === m3.char || m1.char === m3.char) {
        yieldAmount = 5 * (inputCost / 10);
    }

    if (yieldAmount > 0) {
        credits += yieldAmount;
        updateCredits();
        saveNow();
        setFabricatorMessage(`Output yield: +${yieldAmount} credits.`, true);
        if (ultra) {
            triggerUltraOutput();
        }
    } else {
        setFabricatorMessage("Cycle produced minimal usable material.", false);
    }
};

// --- CHEMISTRY JOB LOGIC ---
window.newChemQuestion = function() {
    if (chemQuestions.length === 0) {
        document.getElementById("chemQuestionText").textContent =
            "No questions available.";
        return;
    }
    currentChemIndex = Math.floor(Math.random() * chemQuestions.length);
    document.getElementById("chemQuestionText").textContent =
        chemQuestions[currentChemIndex].q;
    document.getElementById("chemAnswerInput").value = "";
    document.getElementById("chemFeedback").textContent = "";
};

window.submitChemAnswer = function() {
    if (currentChemIndex === null) {
        document.getElementById("chemFeedback").textContent =
            "Request a new question first.";
        return;
    }
    const userAns = document.getElementById("chemAnswerInput").value.trim();
    const correctAns = chemQuestions[currentChemIndex].a.trim();

    if (userAns.toLowerCase() === correctAns.toLowerCase()) {
        const reward = 40;
        credits += reward;
        updateCredits();
        saveNow();
        document.getElementById("chemFeedback").textContent =
            `Correct. You earned ${reward} credits.`;
    } else {
        document.getElementById("chemFeedback").textContent =
            `Incorrect. Correct answer: ${correctAns}`;
    }
    currentChemIndex = null;
};

// --- ADMIN MENU ---
function revealAdminMenu() {
    document.getElementById("adminMenu").style.display = "block";
}

window.adminLogin = function() {
    // password: "QuantumAdmin42" obfuscated
    const parts = ["UXVh", "bnR1", "bUFk", "bWlu", "NDI="];
    const encoded = parts.join("");
    const realPassword = atob(encoded);

    const attempt = prompt("Enter admin password:");
    if (attempt === realPassword) {
        revealAdminMenu();
    } else if (attempt !== null) {
        alert("Access denied.");
    }
};

window.adminSetMoney = function() {
    const val = parseInt(document.getElementById("adminMoneyInput").value, 10);
    if (Number.isFinite(val)) {
        credits = val;
        updateCredits();
        saveNow();
    }
};

window.adminAddQuestion = function() {
    const q = document.getElementById("adminQInput").value.trim();
    const a = document.getElementById("adminAInput").value.trim();
    if (!q || !a) return;
    chemQuestions.push({ q, a });
    document.getElementById("adminQInput").value = "";
    document.getElementById("adminAInput").value = "";
    alert("Question added for this session.");
};
