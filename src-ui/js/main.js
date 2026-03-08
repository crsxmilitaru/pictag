import '@fortawesome/fontawesome-free/css/all.min.css';
import '../css/base.css';
import '../css/components.css';
import '../css/images.css';
import '../css/feedback.css';

import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getVersion } from '@tauri-apps/api/app';
import { initUI } from './ui.js';
import { initAPI } from './api.js';

const appWindow = getCurrentWebviewWindow();

document.getElementById('titlebar-minimize').addEventListener('click', () => appWindow.minimize());
document.getElementById('titlebar-maximize').addEventListener('click', () => appWindow.toggleMaximize());
document.getElementById('titlebar-close').addEventListener('click', () => appWindow.close());
const titlebarDrag = document.getElementById('titlebar-drag-region');
if (titlebarDrag) {
    titlebarDrag.addEventListener('mousedown', (e) => {
        if (e.buttons === 1) appWindow.startDragging();
    });
}

async function checkMaximized() {
    const isMaximized = await appWindow.isMaximized();
    document.body.classList.toggle('maximized', isMaximized);
}

checkMaximized();
window.addEventListener('resize', checkMaximized);

// Helper to select elements with type checking
/**
 * @template {HTMLElement} T
 * @param {string} id
 * @param {new () => T} type
 * @returns {T}
 */
const $ = (id, type) => {
    const element = document.getElementById(id);
    if (!(element instanceof type)) {
        throw new Error(`Element ${id} is not of type ${type.name}`);
    }
    return element;
};

// DOM element cache
const el = {
    ollamaUrl: $('ollamaUrl', HTMLInputElement),
    analyzePrompt: $('analyzePrompt', HTMLTextAreaElement),
    modelSelect: $('modelSelect', HTMLInputElement),
    selectedModel: $('selectedModel', HTMLElement),
    folderPath: $('folderPath', HTMLInputElement),
    imageGrid: $('imageGrid', HTMLElement),
    resultsCount: $('resultsCount', HTMLElement),
    imagesCard: $('imagesCard', HTMLElement),
    processingCard: $('processingCard', HTMLElement),
    stats: $('stats', HTMLElement),
    successCount: $('successCount', HTMLElement),
    errorCount: $('errorCount', HTMLElement),
    totalCount: $('totalCount', HTMLElement),
    processIcon: $('processIcon', HTMLElement),
    processText: $('processText', HTMLElement),
    refreshIcon: $('refreshIcon', HTMLElement),
    dropdownOptions: $('dropdownOptions', HTMLElement),
    configContent: $('configContent', HTMLElement),
    modelDropdown: $('modelDropdown', HTMLElement),
    scanBtn: $('scanBtn', HTMLButtonElement),
    processBtn: $('processBtn', HTMLButtonElement),
    stopBtn: $('stopBtn', HTMLButtonElement),
    applyBtn: $('applyBtn', HTMLButtonElement),
    applyIcon: $('applyIcon', HTMLElement),
    applyText: $('applyText', HTMLElement),
    skipProcessingBtn: $('skipProcessingBtn', HTMLButtonElement),
    skipProcessingIcon: $('skipProcessingIcon', HTMLElement),
    skipProcessingText: $('skipProcessingText', HTMLElement),
    container: /** @type {HTMLElement} */ (document.querySelector('.container')),
    organizeCard: $('organizeCard', HTMLElement),
    organizeModeEmpty: $('organizeModeEmpty', HTMLElement),
    organizeModeImagesBtn: $('organizeModeImagesBtn', HTMLButtonElement),
    organizeModeTimelineBtn: $('organizeModeTimelineBtn', HTMLButtonElement),
    organizeModeTagsBtn: $('organizeModeTagsBtn', HTMLButtonElement),
    organizeSinglePanel: $('organizeSinglePanel', HTMLElement),
    organizeTimelinePanel: $('organizeTimelinePanel', HTMLElement),
    organizeTagsPanel: $('organizeTagsPanel', HTMLElement),
    tagList: $('tagList', HTMLElement),
    organizeByTagsBtn: $('organizeByTagsBtn', HTMLButtonElement),
    organizeByTagsIcon: $('organizeByTagsIcon', HTMLElement),
    organizeByTagsText: $('organizeByTagsText', HTMLElement),
    organizeImagesBtn: $('organizeImagesBtn', HTMLButtonElement),
    organizeImagesIcon: $('organizeImagesIcon', HTMLElement),
    organizeImagesText: $('organizeImagesText', HTMLElement),
    timelineYearBtn: $('timelineYearBtn', HTMLButtonElement),
    timelineMonthBtn: $('timelineMonthBtn', HTMLButtonElement),
    timelineNestedBtn: $('timelineNestedBtn', HTMLButtonElement),
    organizeTimelineBtn: $('organizeTimelineBtn', HTMLButtonElement),
    organizeTimelineIcon: $('organizeTimelineIcon', HTMLElement),
    organizeTimelineText: $('organizeTimelineText', HTMLElement),
    skipOrganizeBtn: $('skipOrganizeBtn', HTMLButtonElement),
    recursiveScan: $('recursiveScan', HTMLInputElement)
};

// Application state
const state = {
    images: [],
    processing: false,
    pendingRenames: [],
    tagData: {},
    selectedTags: new Set(),
    hasTagOptions: false,
    selectedOrganizeMode: '',
    selectedTimelineGrouping: 'year_month'
};

// Initialize modules
const ui = initUI(el);
const api = initAPI(el, state, ui);

const DEFAULT_PROMPT = "Analyze the image and generate a concise, descriptive filename using 2 to 5 keywords joined by underscores. Strictly output only the filename. Do not explain, do not add file extensions, and do not use punctuation other than underscores. Examples: 'red_sports_car_side_view', 'golden_retriever_playing_park', 'sunset_over_mountains'";

document.getElementById('modalCancelBtn')?.addEventListener('click', ui.closeModal);
document.getElementById('dropdownTrigger')?.addEventListener('click', ui.toggleDropdown);
document.getElementById('loadModelsBtn')?.addEventListener('click', api.loadModels);
document.getElementById('promptHeader')?.addEventListener('click', togglePrompt);
document.getElementById('restorePromptBtn')?.addEventListener('click', restorePrompt);
document.getElementById('pickFolderBtn')?.addEventListener('click', api.pickFolder);
document.getElementById('scanBtn')?.addEventListener('click', api.scanFolder);
document.getElementById('processBtn')?.addEventListener('click', api.generateNames);
document.getElementById('skipProcessingBtn')?.addEventListener('click', api.skipProcessing);
document.getElementById('stopBtn')?.addEventListener('click', api.stopRecognition);
document.getElementById('applyBtn')?.addEventListener('click', api.applyChanges);

document.getElementById('organizeModeImagesBtn')?.addEventListener('click', () => api.selectOrganizeMode('single'));
document.getElementById('organizeModeTimelineBtn')?.addEventListener('click', () => api.selectOrganizeMode('timeline'));
document.getElementById('organizeModeTagsBtn')?.addEventListener('click', () => api.selectOrganizeMode('tags'));

document.getElementById('organizeImagesBtn')?.addEventListener('click', api.organizeAllImages);
document.getElementById('timelineYearBtn')?.addEventListener('click', () => api.selectTimelineGrouping('year'));
document.getElementById('timelineMonthBtn')?.addEventListener('click', () => api.selectTimelineGrouping('month'));
document.getElementById('timelineNestedBtn')?.addEventListener('click', () => api.selectTimelineGrouping('year_month'));
document.getElementById('organizeTimelineBtn')?.addEventListener('click', api.organizeByTimeline);
document.getElementById('organizeByTagsBtn')?.addEventListener('click', api.organizeByTags);
document.getElementById('skipOrganizeBtn')?.addEventListener('click', api.skipOrganize);
document.getElementById('openGithubBtn')?.addEventListener('click', api.openGitHub);
document.getElementById('updateBtn')?.addEventListener('click', api.checkForUpdates);

document.querySelectorAll('.card-header').forEach(header => {
    header.addEventListener('click', () => ui.toggleCard(header));
});

function restorePrompt(e) {
    if (e) e.stopPropagation();
    el.analyzePrompt.value = DEFAULT_PROMPT;
    localStorage.setItem('analyzePrompt', DEFAULT_PROMPT);
}

function togglePrompt() {
    const content = document.getElementById('promptContent');
    const icon = document.getElementById('promptCollapseIcon');
    const isCollapsed = content.classList.toggle('collapsed');
    icon.classList.toggle('collapsed', isCollapsed);
}

// State helpers exposed for UI
function updateScanBtnState() {
    el.scanBtn.disabled = !el.folderPath.value.trim();
}

// Event listeners
el.folderPath.addEventListener('input', updateScanBtnState);
el.ollamaUrl.addEventListener('input', () => {
    localStorage.setItem('ollamaUrl', el.ollamaUrl.value);
});
el.analyzePrompt.addEventListener('input', () => {
    localStorage.setItem('analyzePrompt', el.analyzePrompt.value);
});
el.recursiveScan.addEventListener('change', () => {
    localStorage.setItem('recursiveScan', el.recursiveScan.checked ? '1' : '0');
});

document.addEventListener('click', (e) => {
    if (el.modelDropdown && e.target instanceof Node && !el.modelDropdown.contains(e.target)) {
        el.dropdownOptions.classList.remove('show');
        const trigger = el.modelDropdown.querySelector('.dropdown-trigger');
        if (trigger) trigger.classList.remove('active');
        const card = /** @type {HTMLElement} */ (el.modelDropdown.closest('.card'));
        if (card) card.style.zIndex = '';
    }
});

// Initialization
getVersion().then(v => {
    const versionEl = document.getElementById('appVersion');
    if (versionEl) versionEl.textContent = `v${v}`;
});

const savedUrl = localStorage.getItem('ollamaUrl');
if (savedUrl) el.ollamaUrl.value = savedUrl;

const savedPrompt = localStorage.getItem('analyzePrompt');
if (savedPrompt) {
    el.analyzePrompt.value = savedPrompt;
} else {
    el.analyzePrompt.value = DEFAULT_PROMPT;
}
const savedRecursive = localStorage.getItem('recursiveScan');
if (savedRecursive !== null) {
    el.recursiveScan.checked = savedRecursive === '1';
}
updateScanBtnState();
api.loadModels();
