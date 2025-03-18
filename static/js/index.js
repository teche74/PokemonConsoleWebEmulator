let gba = null;
let biosLoaded = false;
let fpsCounter = null;
let isPaused = false;
let speedMultiplier = 1;
let audioEnabled = true;
let playtime = parseInt(localStorage.getItem('playtime')) || 0;
let playtimeInterval;
const playtimeDisplay = document.getElementById('playtime');
const resumeGameBtn = document.getElementById('resumeGameBtn');
let speedLevels = [1, 2, 3];
let currentSpeedIndex = 0;
let lastFrameTime = performance.now();
let frameCount = 0;


window.onload = () => {
    gba = new GameBoyAdvance();

    const canvas = document.getElementById("emulator");
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
        console.error("Emulator element is missing or not a canvas");
        return;
    }

    const originalWidth = 680;
    const originalHeight = 320;
    canvas.width = originalWidth;
    canvas.height = originalHeight;

    gba.setCanvas(canvas);

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;

    loadBios(`gbajs-master/resources/bios.bin`);

    // loadGameState();

    // setInterval(() => {
    //     if (gba) saveGame();
    // }, 120000);

    document.getElementById("uploadRom").addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => loadGameFromData(e.target.result);
            reader.readAsArrayBuffer(file);
        }
    });

    function resizeCanvas() {
        const aspectRatio = originalWidth / originalHeight;
        if (document.fullscreenElement) {
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            if (screenWidth / screenHeight > aspectRatio) {
                canvas.height = screenHeight;
                canvas.width = screenHeight * aspectRatio;
            } else {
                canvas.width = screenWidth;
                canvas.height = screenWidth / aspectRatio;
            }
            showNotification("Entered fullscreen mode ✅");
        } else {
            canvas.width = originalWidth;
            canvas.height = originalHeight;
            showNotification("Exited fullscreen mode ✅");
        }

        gba.setCanvas(canvas);
    }

    canvas.addEventListener("dblclick", () => {
        if (!document.fullscreenElement) {
            canvas.classList.add("emulator-fullscreen");
            canvas.requestFullscreen().then(() => resizeCanvas()).catch(err => console.error("Failed to enter fullscreen:", err));
        } else {
            document.exitFullscreen().then(() => resizeCanvas());
            canvas.classList.remove("emulator-fullscreen");
        }
    });

    window.addEventListener("resize", resizeCanvas);

    window.addEventListener("keydown", (event) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
            event.preventDefault();
        }
    });

    startFPSCounter();
};


function loadBios(biosPath) {
    console.log(`Attempting to load BIOS from: ${biosPath}`);

    fetch(biosPath)
        .then((response) => {
            if (!response.ok)
                throw new Error(`Failed to fetch BIOS: ${response.statusText}`);
            console.log(`BIOS response status: ${response.status}`);
            return response.arrayBuffer();
        })
        .then((bios) => {
            console.log("BIOS data type:", bios.constructor.name);
            if (bios instanceof ArrayBuffer) {
                gba.setBios(bios);
                biosLoaded = true;
                console.log("BIOS loaded successfully");
                loadGameState();
            } else {
                throw new Error("BIOS data is not an ArrayBuffer");
            }
        })
        .catch((error) => {
            console.error("Failed to load BIOS:", error);
            biosLoaded = true;
        })
        .finally(() => {
            console.log("BIOS load status:", biosLoaded);
        });
}

function loadPresetGame(gamePath) {
    if (!biosLoaded) {
        showNotification("BIOS not loaded yet. Please wait.");
        console.log("BIOS load status:", biosLoaded);
        return;
    }

    console.log(`Loading game from: ${gamePath}`);

    fetch(gamePath)
        .then((response) => {
            if (!response.ok)
                throw new Error(`Failed to fetch game: ${response.statusText}`);
            return response.arrayBuffer();
        })
        .then((data) => loadGameFromData(data))
        .catch((error) => console.error("Error loading game:", error));
}

function loadGameFromData(data) {
    if (gba) {
        try {
            const result = gba.setRom(data);
            if (result) {
                gba.runStable();
                console.log("Game loaded successfully");
            } else {
                console.error("Failed to set ROM");
            }
        } catch (error) {
            console.error("Error loading game:", error);
        }
    } else {
        console.error("GBA instance not initialized");
    }
}

function saveGame() {
    if (!gba) {
        showNotification("GBA instance not initialized ❌");
        return;
    }
    try {
        stopTrackingPlaytime();
        const saveData = gba.freeze();
        if (!saveData) {
            showNotification("Failed to create save state ❌", true);
            return;
        }

        const stateName = prompt("Enter a name for this save state:");
        if (!stateName) return;

        const gameId = getCurrentGameId();
        console.log("Saving for gameId:", gameId);

        let allSavedStates = JSON.parse(localStorage.getItem("gbaSaveStates") || "{}");
        let savedStates = allSavedStates[gameId] || [];

        const existingIndex = savedStates.findIndex(s => s.name === stateName);
        if (existingIndex !== -1) {
            const overwrite = confirm(`State "${stateName}" already exists. Overwrite it?`);
            if (!overwrite) return;
            savedStates[existingIndex] = {
                name: stateName,
                data: JSON.stringify(saveData),
                timestamp: new Date().toLocaleString()
            };
        } else {
            savedStates.push({
                name: stateName,
                data: JSON.stringify(saveData),
                timestamp: new Date().toLocaleString()
            });
        }
        
        allSavedStates[gameId] = savedStates;
        localStorage.setItem("gbaSaveStates", JSON.stringify(allSavedStates));
        showNotification(`Game state "${stateName}" saved! 💾`);
        updateSaveStateList();
    } catch (error) {
        console.error("Failed to save game state:", error);
        showNotification("Failed to save game state ❌", true);
    }
}

function getCurrentGameId() {
    return (gba && gba.mmu && gba.mmu.cart && gba.mmu.cart.code) || "default";
}


function loadGameState() {
    if (!gba) {
        showNotification("GBA instance not initialized ❌");
        return;
    }
    
    const saveStateList = document.getElementById("saveStateList");
    const selectedState = saveStateList.value;
    if (!selectedState) {
        showNotification("Please select a save state first ⏳", true);
        return;
    }

    try {
        const gameId = getCurrentGameId();
        const allSavedStates = JSON.parse(localStorage.getItem("gbaSaveStates") || "{}");
        const savedStates = allSavedStates[gameId] || [];
        const state = savedStates.find(s => s.name === selectedState);

        if (state && state.data) {
            try {
                const gameState = JSON.parse(state.data);
                gba.defrost(gameState);
                setTimeout(() => gba.runStable(), 100);
                startTrackingPlaytime();
                showNotification(`Loaded game state "${state.name}" 🚀`);
            } catch (parseError) {
                console.error("Invalid saved game data:", parseError);
                showNotification("Invalid save state data ❌", true);
            }
        } else {
            showNotification("Selected save state not found ⏳", true);
        }
    } catch (error) {
        console.error("Failed to load game state:", error);
        showNotification("Failed to load game state ❌", true);
    }
}



function updateSaveStateList() {
    const saveStateList = document.getElementById("saveStateList");
    saveStateList.innerHTML = ""; 
    const savedStates = JSON.parse(localStorage.getItem("gbaSaveStates") || "[]");

    if (savedStates.length === 0) {
        const option = document.createElement("option");
        option.textContent = "No saved states available";
        saveStateList.appendChild(option);
    } else {
        savedStates.forEach(state => {
            const option = document.createElement("option");
            option.value = state.name;
            option.textContent = `${state.name} (${state.timestamp})`;
            saveStateList.appendChild(option);
        });
    }
}



function checkResumeButton() {
    if (localStorage.getItem('lastGameState')) {
        resumeGameBtn.style.display = 'inline-block';
    }
}

window.addEventListener('load', () => {
    playtimeDisplay.textContent = formatPlaytime(playtime);
    checkResumeButton();
});

const DEFAULT_KEY_BINDINGS = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    a: "Z",
    b: "X",
    start: "Enter",
    select: "Backspace",
    l: "Q",
    r: "E"
};

let keyBindings = { ...DEFAULT_KEY_BINDINGS };
const usedKeys = new Set();

function loadKeyBindings() {
    const storedBindings = localStorage.getItem("gbaKeyBindings");
    if (storedBindings) {
        const loadedBindings = JSON.parse(storedBindings);
        keyBindings = Object.keys(loadedBindings)
        .filter(key => key in DEFAULT_KEY_BINDINGS) // ✅ Ignore extra keys like "inherit"
        .reduce((acc, key) => {
            acc[key] = loadedBindings[key];
            return acc;
        }, {});
    }
    
    Object.values(keyBindings).forEach(key => usedKeys.add(key));
}


function handleKeyChange(event) {
    const selectedKey = event.target.value;
    const previousKey = event.target.getAttribute("data-previous-value");
    
    if (previousKey) usedKeys.delete(previousKey);
    
    
    if (usedKeys.has(selectedKey)) {
        showNotification(`Key "${selectedKey}" is already assigned!`);
        usedKeys.delete(selectedKey); 
        event.target.value = "";
        return;
    }
    
    usedKeys.add(selectedKey);
    event.target.setAttribute("data-previous-value", selectedKey);
    
    const keyName = event.target.id.replace("key-", "");
    keyBindings[keyName] = selectedKey;
}



function createKeyBindings() {
    const keys = [
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "W", "A", "S", "D", "Enter", "Space", "Backspace",
        "Z", "X", "C", "V", "Q", "E", "R", "T", "Y"
    ];
    
    for (const key in keyBindings) {
        const dropdown = document.getElementById(`key-${key}`);
        dropdown.innerHTML = keys.map(k => 
            `<option value="${k}" ${keyBindings[key] === k ? 'selected' : ''}>${k}</option>`
        ).join("");
        
        dropdown.setAttribute("data-previous-value", keyBindings[key]);
        dropdown.addEventListener("change", handleKeyChange);
    }
}

function saveKeyBindings() {
    const validKeys = Object.keys(DEFAULT_KEY_BINDINGS);
    for (const key of validKeys) {
        const input = document.getElementById(`key-${key}`);
        if (input) {
            keyBindings[key] = input.value;
            console.log(key, " -> ", keyBindings[key]);
        } else {
            console.warn(`No input element found for key-${key}`);
        }
    }
    localStorage.setItem("gbaKeyBindings", JSON.stringify(keyBindings));
    showNotification("Controls saved successfully!");
}



// Attach key listeners
window.addEventListener("keydown", (event) => {
    if (event.key === "p") togglePause();
    // if (event.key === "r") resetGame();
});

function showNotification(message) {
    const container = document.getElementById('notification-container');
    
    const notification = document.createElement('div');
    notification.classList.add('notification');
    
    notification.innerHTML = `
    <img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Poké_Ball_icon.svg" alt="Pokéball">
    <span>${message}</span>
    `;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}


document.addEventListener("DOMContentLoaded", () => {
    updateSaveStateList();
    loadKeyBindings();
    createKeyBindings();
    playtimeDisplay.textContent = formatPlaytime(playtime);

});



function formatPlaytime(seconds) {
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${secs}`;
}

function startTrackingPlaytime() {
    if (playtimeInterval) clearInterval(playtimeInterval); // ✅ Avoid multiple intervals
    playtimeInterval = setInterval(() => {
        playtime++;
        localStorage.setItem('playtime', playtime);
        playtimeDisplay.textContent = formatPlaytime(playtime);
    }, 1000);
}

function stopTrackingPlaytime() {
    clearInterval(playtimeInterval);
}


// --- ⏯️ Pause/Resume ---
function togglePause() {
    if (!gba) return;
    if (isPaused) {
        gba.runStable();
        startTrackingPlaytime();
        showNotification("Game Resumed ▶️");
    } else {
        gba.pause();
        stopTrackingPlaytime();
        showNotification("Game Paused ⏸️");
    }
    isPaused = !isPaused;
}

// --- 🔄 Reset ---
function resetGame() {
    if (gba.hasRom()) {
        gba.reset(); 
        console.log('Game reset successfully!');
    } else {
        console.log('No ROM loaded. Please load a ROM first.');
    }
}

// --- 🔊 Toggle Audio ---
function toggleAudio() {
    gba.toggleAudio();
}

// --- ⚡ Speed Control ---
function updateSpeed() {
    currentSpeedIndex = (currentSpeedIndex + 1) % speedLevels.length;
    gba.updateSpeed(speedLevels[currentSpeedIndex]);
    console.log(`Speed set to: ${speedLevels[currentSpeedIndex]}x`);
}

function checkResumeButton() {
    if (localStorage.getItem('gba-save')) {
        resumeGameBtn.style.display = 'inline-block';
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("pause-btn").addEventListener("click", togglePause);
    document.getElementById("reset-btn").addEventListener("click", resetGame);
    document.getElementById("audio-toggle").addEventListener("click", toggleAudio);
    document.getElementById("speed-control").addEventListener("input", updateSpeed);
    playtimeDisplay.textContent = formatPlaytime(playtime);
    checkResumeButton();
});

function startFPSCounter() {
    function updateFPS() {
        frameCount++;
        const now = performance.now();
        const delta = now - lastFrameTime;
        
        if (delta >= 1000) {
            const fps = Math.round((frameCount / delta) * 1000);
            const fpsDisplay = document.getElementById('fpsDisplay');
            if (fpsDisplay) {
                fpsDisplay.textContent = `FPS: ${fps}`;
            } else {
                console.error('fpsDisplay element not found');
            }
            frameCount = 0;
            lastFrameTime = now;
        }
        
        requestAnimationFrame(updateFPS);
    }
    requestAnimationFrame(updateFPS);
}

document.getElementById("saveStateList").addEventListener("change", loadGameState);