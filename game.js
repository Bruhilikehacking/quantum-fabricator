import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, where 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- FIREBASE CONFIG (YOUR VALUES) ---
const firebaseConfig = {
    apiKey: "AIzaSyCwtZRAKW4KPUMG7Lj9DF8bWiC51ywnc6U",
    authDomain: "quantum-fabricator.firebaseapp.com",
    projectId: "quantum-fabricator",
    storageBucket: "quantum-fabricator.firebasestorage.app",
    messagingSenderId: "96015622587",
    appId: "1:96015622587:web:7a39bd07332fdde4b9e49e"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- GAME STATE ---
let credits = 100;
let lastSavedCredits = 100;
let inputCost = 10;

const materials = [
    { char: "Fe", weight: 45, yield: 20 },
    { char: "Cu", weight: 30, yield: 30 },
    { char: "Ag", weight: 15, yield: 70 },
    { char: "Au", weight: 7,  yield: 200 },
    { char: "Xe", weight: 2,  yield: 500 },
    { char: "Q*", weight: 1,  yield: 1500 }
];
const totalWeight = materials.reduce((s, x) => s + x.weight, 0);

const shells = [
    { id: "default", name: "Standard Shell", cost: 0, className: "shell-default" },
    { id: "gold",    name: "Auric Shell",    cost: 2000, className: "shell-gold" },
    { id: "void",    name: "Void Shell",     cost: 5000, className: "shell-void" }
];
let ownedShells = ["default"];
let currentShellId = "default";

// --- UPGRADES ---
let upgrades = {
    inputEfficiency: 0, // reduces input cost
    outputBooster: 0,   // increases yield
    ultraChance: 0,     // increases chance of Q*
    chemBonus: 0        // increases chem rewards
};

const upgradeDefs = [
    {
        id: "inputEfficiency",
        name: "Input Efficiency",
        maxLevel: 3,
        baseCost: 500,
        desc: "Reduces input cost per cycle."
    },
    {
        id: "outputBooster",
        name: "Output Booster",
        maxLevel: 3,
        baseCost: 800,
        desc: "Increases output from matches."
    },
    {
        id: "ultraChance",
        name: "Ultra Output Chance",
        maxLevel: 3,
        baseCost: 1200,
        desc: "Slightly increases chance of rare Q* material."
    },
    {
        id: "chemBonus",
        name: "Chemistry Bonus",
        maxLevel: 3,
        baseCost: 600,
        desc: "Increases credits from Chemistry Shift."
    }
];

// --- CHEMISTRY QUESTIONS WITH TIERS ---
let chemQuestions = {
    easy: [
        { q: "What is the chemical symbol for Helium?", a: "He" },
        { q: "How many protons does Oxygen have?", a: "8" },
        { q: "What is the pH of pure water?", a: "7" },
        { q: "What is the chemical formula for water?", a: "H2O" },
        { q: "What is the chemical symbol for Sodium?", a: "Na" },
        { q: "What subatomic particle has a negative charge?", a: "Electron" },
        { q: "What is the chemical symbol for Carbon?", a: "C" },
        { q: "What is the chemical symbol for Iron?", a: "Fe" },
        { q: "What state of matter has a definite shape?", a: "Solid" }
    ],
    medium: [
        { q: "What type of bond involves sharing electrons?", a: "Covalent" },
        { q: "What type of bond involves transferring electrons?", a: "Ionic" },
        { q: "What is the chemical formula for methane?", a: "CH4" },
        { q: "What is the universal solvent?", a: "Water" },
        { q: "What is the term for a substance that speeds up a reaction?", a: "Catalyst" },
        { q: "What is the term for the starting substances in a reaction?", a: "Reactants" },
        { q: "What is the term for the substances produced?", a: "Products" },
        { q: "What is the chemical formula for ammonia?", a: "NH3" },
        { q: "What is the term for a uniform mixture?", a: "Homogeneous" }
    ],
    hard: [
        { q: "What is the SI unit for amount of substance?", a: "Mole" },
        { q: "What number does one mole represent?", a: "6.022e23" },
        { q: "What is the term for a reaction that absorbs heat?", a: "Endothermic" },
        { q: "What is the term for a reaction that releases heat?", a: "Exothermic" },
        { q: "What is the chemical formula for sulfuric acid?", a: "H2SO4" },
        { q: "What is the chemical formula for nitric acid?", a: "HNO3" },
        { q: "What is the term for a negatively charged ion?", a: "Anion" },
        { q: "What is the term for a positively charged ion?", a: "Cation" },
        { q: "What is the term for the smallest unit of a compound?", a: "Molecule" }
    ]
};

let currentChemTier = "easy";
let currentChemIndex = null;

// --- AUTH ---
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
        renderUpgrades();
        await loadLeaderboard();
    } else {
        document.getElementById("authScreen").style.display = "block";
        document.getElementById("gameContainer").style.display = "none";
    }
});

// --- SAVE / LOAD ---
async function saveProgress(uid) {
    if (!Number.isFinite(credits)) credits = 0;
    if (credits < -1000000) credits = -1000000;
    if (credits > 1000000000) credits = 1000000000;

    const delta = credits - lastSavedCredits;
    if (Math.abs(delta) > 500000) {
        credits = lastSavedCredits;
    }

    lastSavedCredits = credits;

    await setDoc(doc(db, "operators", uid), {
        email: auth.currentUser?.email || "unknown",
        credits: credits,
        ownedShells: ownedShells,
        currentShellId: currentShellId,
        upgrades: upgrades,
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

        if (data.upgrades && typeof data.upgrades === "object") {
            upgrades = {
                inputEfficiency: data.upgrades.inputEfficiency || 0,
                outputBooster: data.upgrades.outputBooster || 0,
                ultraChance: data.upgrades.ultraChance || 0,
                chemBonus: data.upgrades.chemBonus || 0
            };
        } else {
            upgrades = {
                inputEfficiency: 0,
                outputBooster: 0,
                ultraChance: 0,
                chemBonus: 0
            };
        }
    } else {
        credits = 100;
        lastSavedCredits = 100;
        ownedShells = ["default"];
        currentShellId = "default";
        upgrades = {
            inputEfficiency: 0,
            outputBooster: 0,
            ultraChance: 0,
            chemBonus: 0
        };
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

// --- INPUT COST (with efficiency upgrade) ---
window.setInputCost = function(amount) {
    inputCost = amount;
    document.getElementById("inputAmount").textContent = inputCost;
};

function getEffectiveInputCost() {
    const level = upgrades.inputEfficiency || 0;
    const reduction = [0, 0.05, 0.10, 0.15][level] || 0;
    return Math.max(1, Math.round(inputCost * (1 - reduction)));
}

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
                updateCredits();
                ownedShells.push(shell.id);
                saveNow();
            }
            applyShell(shell.id);
            saveNow();
            renderShells();
        };

        list.appendChild(btn);
    });
}

// --- UPGRADES RENDER & BUY ---
function getUpgradeLevel(id) {
    return upgrades[id] || 0;
}

function getUpgradeCost(def, level) {
    // simple scaling: baseCost * (level + 1)
    return def.baseCost * (level + 1);
}

function renderUpgrades() {
    const list = document.getElementById("upgradeList");
    if (!list) return;
    list.innerHTML = "";

    upgradeDefs.forEach(def => {
        const level = getUpgradeLevel(def.id);
        const maxed = level >= def.maxLevel;
        const cost = getUpgradeCost(def, level);

        const btn = document.createElement("button");
        let label = `${def.name} (Lv ${level}/${def.maxLevel}) - ${def.desc}`;
        if (!maxed) {
            label += ` | Next: ${cost} credits`;
        } else {
            label += " | MAXED";
        }
        btn.textContent = label;

        btn.onclick = () => {
            if (maxed) {
                alert("This upgrade is already at max level.");
                return;
            }
            if (credits < cost) {
                alert("Insufficient credits for this upgrade.");
                return;
            }
            credits -= cost;
            upgrades[def.id] = level + 1;
            updateCredits();
            saveNow();
            renderUpgrades();
        };

        list.appendChild(btn);
    });
}

// --- MATERIAL SELECTION (with ultraChance upgrade) ---
function weightedRandomMaterial() {
    // ultraChance upgrade: small extra chance to force Q*
    const level = upgrades.ultraChance || 0;
    const bonusChance = [0, 0.001, 0.002, 0.005][level] || 0;
    if (Math.random() < bonusChance) {
        return materials.find(m => m.char === "Q*") || materials[materials.length - 1];
    }

    let r = Math.random() * totalWeight;
    for (const m of materials) {
        if (r < m.weight) return m;
        r -= m.weight;
    }
    return materials[0];
}

// --- ULTRA OUTPUT ---
function triggerUltraOutput() {
    const overlay = document.getElementById("ultraOverlay");
    overlay.style.display = "flex";
    setTimeout(() => {
        overlay.style.display = "none";
    }, 1200);
}

// --- FABRICATOR LOGIC (with outputBooster) ---
window.cycleFabricator = function() {
    const effectiveCost = getEffectiveInputCost();

    if (credits < effectiveCost) {
        setFabricatorMessage("Insufficient credits. Report to chemistry shift.", false);
        return;
    }

    credits -= effectiveCost;
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
        yieldAmount = m1.yield * (effectiveCost / 10);
        if (m1.char === "Q*") {
            ultra = true;
        }
    } else if (m1.char === m2.char || m2.char === m3.char || m1.char === m3.char) {
        yieldAmount = 5 * (effectiveCost / 10);
    }

    // apply outputBooster
    const outLevel = upgrades.outputBooster || 0;
    const outBonus = [0, 0.05, 0.10, 0.20][outLevel] || 0;
    yieldAmount = Math.round(yieldAmount * (1 + outBonus));

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

// --- CHEMISTRY JOB (with tiers + chemBonus) ---
window.setChemDifficulty = function(tier) {
    if (!chemQuestions[tier]) return;
    currentChemTier = tier;
    const label = document.getElementById("chemDifficultyLabel");
    let base = 40;
    if (tier === "medium") base = 80;
    if (tier === "hard") base = 150;
    label.textContent = `Current: ${tier.charAt(0).toUpperCase() + tier.slice(1)} (base reward ${base})`;
};

window.newChemQuestion = function() {
    const pool = chemQuestions[currentChemTier];
    if (!pool || pool.length === 0) {
        document.getElementById("chemQuestionText").textContent =
            "No questions available for this tier.";
        return;
    }
    currentChemIndex = Math.floor(Math.random() * pool.length);
    document.getElementById("chemQuestionText").textContent =
        pool[currentChemIndex].q;
    document.getElementById("chemAnswerInput").value = "";
    document.getElementById("chemFeedback").textContent = "";
};

window.submitChemAnswer = function() {
    if (currentChemIndex === null) {
        document.getElementById("chemFeedback").textContent =
            "Request a new question first.";
        return;
    }
    const pool = chemQuestions[currentChemTier];
    if (!pool || !pool[currentChemIndex]) {
        document.getElementById("chemFeedback").textContent =
            "Question not found. Request a new one.";
        currentChemIndex = null;
        return;
    }

    const userAns = document.getElementById("chemAnswerInput").value.trim();
    const correctAns = pool[currentChemIndex].a.trim();

    let baseReward = 40;
    if (currentChemTier === "medium") baseReward = 80;
    if (currentChemTier === "hard") baseReward = 150;

    const chemLevel = upgrades.chemBonus || 0;
    const chemBonus = [0, 0.10, 0.20, 0.40][chemLevel] || 0;
    const reward = Math.round(baseReward * (1 + chemBonus));

    if (userAns.toLowerCase() === correctAns.toLowerCase()) {
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

// --- CHEMISTRY SHIFT TOGGLE ---
window.toggleChemShift = function() {
    const panel = document.getElementById("chemJob");
    if (panel.style.display === "block") {
        panel.style.display = "none";
    } else {
        panel.style.display = "block";
    }
};

// --- ADMIN MENU ---
function revealAdminMenu() {
    document.getElementById("adminMenu").style.display = "block";
}

window.adminLogin = function() {
    // password: "GreenOrange" obfuscated
    const parts = ["R3JlZW4=", "T3Jhbmdl"];
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
    // add to current tier (easy) by default
    chemQuestions.easy.push({ q, a });
    document.getElementById("adminQInput").value = "";
    document.getElementById("adminAInput").value = "";
    alert("Question added to Easy tier for this session.");
};

// Admin: set another player's credits by email
window.adminSetPlayerCredits = async function() {
    const email = document.getElementById("adminTargetEmail").value.trim();
    const val = parseInt(document.getElementById("adminTargetCredits").value, 10);
    if (!email || !Number.isFinite(val)) {
        alert("Provide a valid email and credit value.");
        return;
    }

    try {
        const q = query(
            collection(db, "operators"),
            where("email", "==", email)
        );
        const snap = await getDocs(q);
        if (snap.empty) {
            alert("No operator found with that email.");
            return;
        }

        for (const docSnap of snap.docs) {
            await setDoc(doc(db, "operators", docSnap.id), {
                ...docSnap.data(),
                credits: val,
                updatedAt: Date.now()
            });
        }

        alert("Player credits updated.");
        await loadLeaderboard();
    } catch (err) {
        console.error(err);
        alert("Error updating player credits.");
    }
};
