import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

export function initAPI(el, state, ui) {
    function collectFileNames() {
        const fileNames = [];
        const cards = el.imageGrid.children;
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            if (card.classList.contains('empty-state')) continue;
            const nameDiv = card.querySelector('.image-name');
            const fullName = nameDiv.dataset.fullName || nameDiv.textContent;
            if (fullName) {
                fileNames.push(fullName);
            }
        }
        return fileNames;
    }

    function syncOrganizeModeUI() {
        const mode = state.selectedOrganizeMode;
        el.organizeModeImagesBtn.classList.toggle('active', mode === 'single');
        el.organizeModeTimelineBtn.classList.toggle('active', mode === 'timeline');
        el.organizeModeTagsBtn.classList.toggle('active', mode === 'tags');
        el.organizeSinglePanel.classList.toggle('active', mode === 'single');
        el.organizeTimelinePanel.classList.toggle('active', mode === 'timeline');
        el.organizeTagsPanel.classList.toggle('active', mode === 'tags');
        el.organizeModeEmpty.classList.toggle('hidden', Boolean(mode));

        el.timelineYearBtn.classList.toggle('active', state.selectedTimelineGrouping === 'year');
        el.timelineMonthBtn.classList.toggle('active', state.selectedTimelineGrouping === 'month');
        el.timelineNestedBtn.classList.toggle('active', state.selectedTimelineGrouping === 'year_month');
    }

    function renderTagOptions(tags) {
        if (tags.length === 0) {
            el.tagList.innerHTML = '<div class="tag-empty">No repeated tags found in the current filenames. Generate names first if you want tag folders.</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < tags.length; i++) {
            const tag = tags[i];
            state.tagData[tag.name] = tag.files;

            const pill = document.createElement('div');
            pill.className = 'tag-pill';
            pill.style.animationDelay = `${i * 30}ms`;
            pill.dataset.tag = tag.name;
            pill.innerHTML = `<i class="fa-solid fa-check tag-check"></i><span class="tag-name">${tag.name}</span><span class="tag-count">${tag.count}</span>`;
            pill.onclick = () => toggleTagSelection(tag.name, pill);
            fragment.appendChild(pill);
        }

        el.tagList.innerHTML = '';
        el.tagList.appendChild(fragment);
    }

    function resetOrganizeFlow() {
        state.tagData = {};
        state.selectedTags.clear();
        state.hasTagOptions = false;
        state.selectedOrganizeMode = '';
        state.selectedTimelineGrouping = 'year_month';
        el.tagList.innerHTML = '';
        syncOrganizeModeUI();
        updateOrganizeButtons();
    }

    function updateOrganizeButtons() {
        const hasFiles = collectFileNames().length > 0;
        const isTimelineMode = hasFiles && state.selectedOrganizeMode === 'timeline';

        el.organizeModeImagesBtn.disabled = !hasFiles;
        el.organizeModeTimelineBtn.disabled = !hasFiles;
        el.organizeModeTagsBtn.disabled = !hasFiles;

        el.organizeImagesBtn.disabled = !(hasFiles && state.selectedOrganizeMode === 'single');
        el.organizeTimelineBtn.disabled = !isTimelineMode;
        el.timelineYearBtn.disabled = !isTimelineMode;
        el.timelineMonthBtn.disabled = !isTimelineMode;
        el.timelineNestedBtn.disabled = !isTimelineMode;
        el.organizeByTagsBtn.disabled = !(hasFiles && state.selectedOrganizeMode === 'tags' && state.hasTagOptions && state.selectedTags.size > 0);
        el.skipOrganizeBtn.disabled = !hasFiles;
    }

    function setOrganizeBusy(isBusy) {
        if (isBusy) {
            el.organizeModeImagesBtn.disabled = true;
            el.organizeModeTimelineBtn.disabled = true;
            el.organizeModeTagsBtn.disabled = true;
            el.organizeImagesBtn.disabled = true;
            el.organizeTimelineBtn.disabled = true;
            el.timelineYearBtn.disabled = true;
            el.timelineMonthBtn.disabled = true;
            el.timelineNestedBtn.disabled = true;
            el.organizeByTagsBtn.disabled = true;
            el.skipOrganizeBtn.disabled = true;
            return;
        }
        updateOrganizeButtons();
    }

    function toggleTagSelection(tag, pill) {
        const isSelected = state.selectedTags.has(tag);
        pill.classList.toggle('selected', !isSelected);
        isSelected ? state.selectedTags.delete(tag) : state.selectedTags.add(tag);
        updateOrganizeButtons();
    }

    function selectOrganizeMode(mode) {
        if (collectFileNames().length === 0) return;
        state.selectedOrganizeMode = state.selectedOrganizeMode === mode ? '' : mode;
        syncOrganizeModeUI();
        updateOrganizeButtons();
    }

    function selectTimelineGrouping(grouping) {
        state.selectedTimelineGrouping = grouping;
        syncOrganizeModeUI();
        updateOrganizeButtons();
    }

    function clearRenameSuggestions() {
        state.pendingRenames = [];
        for (const card of el.imageGrid.children) {
            card.classList.remove('success', 'error', 'processing');
            const status = card.querySelector('.image-status');
            const nameDiv = card.querySelector('.image-name');

            if (status) {
                status.innerHTML = '';
            }

            if (nameDiv) {
                nameDiv.textContent = ui.displayName(nameDiv.dataset.fullName || nameDiv.textContent || '');
                delete nameDiv.dataset.original;
            }
        }

        el.applyBtn.style.display = 'none';
        el.applyBtn.disabled = false;
        el.applyIcon.innerHTML = '<i class="fa-solid fa-check"></i>';
        el.applyText.textContent = 'Apply Changes';
        el.stopBtn.style.display = 'none';
        el.stopBtn.disabled = false;
        el.stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        el.processBtn.disabled = collectFileNames().length === 0;
        el.skipProcessingBtn.disabled = collectFileNames().length === 0;
        el.processIcon.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
        el.processText.textContent = 'Generate Names';
        el.stats.classList.add('hidden');
    }

    async function prepareOrganizeOptions() {
        const fileNames = collectFileNames();
        resetOrganizeFlow();

        if (fileNames.length === 0) {
            el.organizeCard.classList.add('disabled');
            ui.collapseCard(el.organizeCard);
            return;
        }

        let tags = [];
        try {
            tags = await invoke('analyze_tags', { fileNames });
        } catch (error) {
            ui.showToast('Failed to analyze tags: ' + error, 'error');
        }

        state.hasTagOptions = tags.length > 0;
        renderTagOptions(tags);
        el.organizeCard.classList.remove('disabled');
        ui.expandCard(el.organizeCard);
        updateOrganizeButtons();
    }

    function handleOrganizeResults(results) {
        const cardMap = new Map();
        const cards = el.imageGrid.children;
        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const nameDiv = card.querySelector('.image-name');
            if (nameDiv) cardMap.set(nameDiv.dataset.fullName, card);
        }

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.success) {
                successCount++;
                const card = cardMap.get(result.original);
                if (card) {
                    card.querySelector('.image-status').innerHTML = `<span class="success-text">Moved to ${result.new_name}</span>`;
                    card.classList.add('success');
                }
            } else {
                errorCount++;
                const card = cardMap.get(result.original);
                if (card) {
                    card.querySelector('.image-status').innerHTML = `<span class="error-text">${result.error}</span>`;
                    card.classList.add('error');
                }
            }
        }

        el.organizeCard.classList.add('disabled');
        ui.collapseCard(el.organizeCard);
        resetOrganizeFlow();

        if (errorCount > 0) {
            ui.showToast(`Organized ${successCount} files. ${errorCount} failed.`, 'error');
        } else if (successCount > 0) {
            ui.showToast(`Successfully organized ${successCount} files into folders.`, 'success');
        }

        if (successCount > 0) {
            state.images = [];
            state.pendingRenames = [];
            state.tagData = {};
            el.imageGrid.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="fa-solid fa-folder-open"></i></div><p>Files have been moved. Scan again to continue.</p></div>';
            el.resultsCount.textContent = '0 images';
            el.imagesCard.classList.add('disabled');
            ui.collapseCard(el.imagesCard);
            el.processingCard.classList.add('disabled');
            ui.collapseCard(el.processingCard);
            el.processBtn.disabled = true;
            el.skipProcessingBtn.disabled = true;
            el.applyBtn.style.display = 'none';
            el.stats.classList.add('hidden');
            updateOrganizeButtons();
        }
    }

    async function loadModels() {
        const trigger = el.modelDropdown.querySelector('.dropdown-trigger');
        trigger.classList.add('disabled');
        el.refreshIcon.innerHTML = '<div class="spinner"></div>';
        try {
            localStorage.setItem('ollamaUrl', el.ollamaUrl.value);
            const models = await invoke('get_models', { url: el.ollamaUrl.value });
            el.dropdownOptions.innerHTML = models.length === 0
                ? '<div class="dropdown-option" style="cursor: default; opacity: 0.5;">No vision models found</div>'
                : '';

            models.forEach(model => {
                const div = document.createElement('div');
                div.className = 'dropdown-option';
                div.innerHTML = `<i class="fa-solid fa-brain" style="font-size: 0.8em; opacity: 0.7;"></i> <span>${model}</span>`;
                div.onclick = () => ui.selectModel(model);
                el.dropdownOptions.appendChild(div);
            });

            if (models.length > 0) {
                const saved = localStorage.getItem('selectedModel');
                if (saved && models.includes(saved)) {
                    ui.selectModel(saved);
                } else {
                    ui.selectModel(models[0]);
                }
            }
        } catch (error) {
            ui.showToast('Failed to load models: ' + error, 'error');
        }
        el.refreshIcon.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        trigger.classList.remove('disabled');
    }

    async function pickFolder() {
        try {
            const folder = await invoke('pick_folder');
            if (folder) {
                el.folderPath.value = folder;
                el.scanBtn.disabled = false;
                await scanFolder();
            }
        } catch (error) {
            ui.showToast('Failed to pick folder: ' + error, 'error');
        }
    }

    async function scanFolder() {
        if (!el.folderPath.value) {
            ui.showToast('Please enter a folder path', 'error');
            return;
        }
        try {
            state.pendingRenames = [];
            resetOrganizeFlow();
            el.organizeCard.classList.add('disabled');
            ui.collapseCard(el.organizeCard);
            el.applyBtn.style.display = 'none';
            el.stopBtn.style.display = 'none';
            el.skipProcessingBtn.disabled = true;
            el.stats.classList.add('hidden');
            state.images = await invoke('scan_folder', { folder: el.folderPath.value, recursive: el.recursiveScan.checked });
            el.imageGrid.innerHTML = '';

            if (state.images.length === 0) {
                const emptyMessage = el.recursiveScan.checked
                    ? 'No images found in this folder or subfolders'
                    : 'No images found in this folder';
                el.imageGrid.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="fa-solid fa-image"></i></div><p>${emptyMessage}</p></div>`;
                el.imagesCard.classList.remove('disabled');
                ui.expandCard(el.imagesCard);

                el.processingCard.classList.add('disabled');
                ui.collapseCard(el.processingCard);

                el.resultsCount.textContent = '0 images';
                el.processBtn.disabled = true;
                el.skipProcessingBtn.disabled = true;
                return;
            }

            el.processBtn.disabled = false;
            el.skipProcessingBtn.disabled = false;
            el.resultsCount.textContent = `${state.images.length} image${state.images.length !== 1 ? 's' : ''}`;
            state.images.forEach((img, index) => {
                const card = document.createElement('div');
                card.className = 'image-card';
                card.style.animationDelay = `${index * 30}ms`;
                card.innerHTML = `
                    <div class="image-preview">
                        <img src="${convertFileSrc(img.path)}" alt="${img.name}" loading="lazy">
                    </div>
                    <div class="image-name" data-full-name="${img.relative_path}">${ui.displayName(img.name)}</div>
                    <div class="image-status"></div>
                `;
                el.imageGrid.appendChild(card);
            });

            el.imagesCard.classList.remove('disabled');
            ui.expandCard(el.imagesCard);

            el.processingCard.classList.remove('disabled');
            ui.expandCard(el.processingCard);

            el.stats.classList.add('hidden');

            setTimeout(() => {
                el.container.scrollTo({
                    top: el.container.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);
        } catch (error) {
            ui.showToast('Failed to scan folder: ' + error, 'error');
        }
    }

    async function generateNames() {
        if (state.processing) return;
        if (!el.modelSelect.value) {
            ui.showToast('Please select a model', 'error');
            return;
        }

        state.processing = true;
        state.pendingRenames = [];
        el.processBtn.disabled = true;
        el.skipProcessingBtn.disabled = true;
        el.processIcon.innerHTML = '<div class="spinner"></div>';
        el.processText.textContent = 'Generating...';
        el.stopBtn.disabled = false;
        el.stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
        el.stopBtn.style.display = 'inline-flex';
        el.applyBtn.style.display = 'none';

        let stats = { success: 0, error: 0 };
        const updateStats = () => {
            el.successCount.textContent = stats.success;
            el.errorCount.textContent = stats.error;
            el.totalCount.textContent = stats.success + stats.error;
        };

        updateStats();
        el.stats.classList.remove('hidden');

        for (let card of el.imageGrid.children) {
            card.classList.remove('success', 'error', 'processing');
            const status = card.querySelector('.image-status');
            if (status) status.textContent = '';
            const imgNameDiv = card.querySelector('.image-name');
            if (imgNameDiv.dataset.original) {
                imgNameDiv.textContent = ui.displayName(imgNameDiv.dataset.original);
            }
        }

        const unlistenProcessing = await listen('image-processing', (event) => {
            const name = event.payload;
            for (let card of el.imageGrid.children) {
                const nameDiv = card.querySelector('.image-name');
                if (nameDiv.dataset.fullName === name) {
                    card.classList.add('processing');
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    break;
                }
            }
        });

        const unlistenProcessed = await listen('image-processed', (event) => {
            const result = event.payload;
            for (let card of el.imageGrid.children) {
                const nameDiv = card.querySelector('.image-name');
                if (nameDiv.dataset.fullName === result.original || nameDiv.dataset.original === result.original) {
                    card.classList.remove('processing');
                    const status = card.querySelector('.image-status');

                    if (result.success) {
                        nameDiv.dataset.original = result.original;
                        nameDiv.innerHTML = `
                            <div class="rename-preview">
                                <div class="rename-old">${ui.displayName(result.original)}</div>
                                <div class="rename-arrow"><i class="fa-solid fa-arrow-down"></i></div>
                                <div class="rename-new">${ui.displayName(result.new_name)}</div>
                            </div>
                        `;
                        status.innerHTML = '';
                        state.pendingRenames.push({ original: result.original, new_name: result.new_name });
                        stats.success++;
                    } else {
                        card.classList.add('error');
                        status.innerHTML = `<span class="error-text">${result.error}</span>`;
                        stats.error++;
                    }
                    updateStats();
                    break;
                }
            }
        });

        try {
            await invoke('generate_names', {
                folder: el.folderPath.value,
                model: el.modelSelect.value,
                ollamaUrl: el.ollamaUrl.value,
                analyzePrompt: el.analyzePrompt.value,
                recursive: el.recursiveScan.checked
            });

            await new Promise(r => setTimeout(r, 500));
        } catch (error) {
            ui.showToast('Failed to generate names: ' + error, 'error');
        }

        unlistenProcessing();
        unlistenProcessed();
        state.processing = false;
        el.processBtn.disabled = false;
        el.skipProcessingBtn.disabled = false;
        el.processIcon.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i>';
        el.processText.textContent = 'Generate Names';
        el.stopBtn.style.display = 'none';

        if (state.pendingRenames.length > 0) {
            el.applyBtn.style.display = 'inline-flex';
            setTimeout(() => {
                el.container.scrollTo({
                    top: el.container.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);
        }
    }

    async function stopRecognition() {
        try {
            await invoke('stop_recognition');
            el.stopBtn.disabled = true;
            el.stopBtn.innerHTML = '<div class="spinner"></div> Stop';
        } catch (error) {
            ui.showToast('Failed to stop recognition: ' + error, 'error');
        }
    }

    async function applyChanges() {
        if (state.pendingRenames.length === 0) return;

        const confirmed = await ui.showModal(
            'Confirm Rename',
            `Are you sure you want to rename ${state.pendingRenames.length} image${state.pendingRenames.length !== 1 ? 's' : ''}? This operation cannot be easily undone.`
        );
        if (!confirmed) return;

        el.applyBtn.disabled = true;
        el.applyIcon.innerHTML = '<div class="spinner"></div>';
        el.applyText.textContent = 'Applying...';
        el.processBtn.disabled = true;
        el.skipProcessingBtn.disabled = true;

        try {
            const results = await invoke('apply_renames', {
                folder: el.folderPath.value,
                renames: state.pendingRenames
            });

            results.forEach(result => {
                for (let card of el.imageGrid.children) {
                    const nameDiv = card.querySelector('.image-name');
                    if (nameDiv.dataset.original === result.original) {
                        const status = card.querySelector('.image-status');
                        if (result.success) {
                            card.classList.add('success');
                            nameDiv.textContent = ui.displayName(result.new_name);
                            nameDiv.dataset.fullName = result.new_name;
                            delete nameDiv.dataset.original;
                            status.innerHTML = `<span class="success-text">Success</span>`;
                        } else {
                            card.classList.add('error');
                            status.innerHTML = `<span class="error-text">${result.error}</span>`;
                        }
                        break;
                    }
                }
            });

            state.pendingRenames = [];
            el.applyBtn.style.display = 'none';

        } catch (error) {
            ui.showToast('Failed to apply changes: ' + error, 'error');
        }

        el.applyBtn.disabled = false;
        el.processBtn.disabled = false;
        el.skipProcessingBtn.disabled = false;
        el.applyIcon.innerHTML = '<i class="fa-solid fa-check"></i>';
        el.applyText.textContent = 'Apply Changes';

        await prepareOrganizeOptions();

        setTimeout(() => {
            el.container.scrollTo({
                top: el.container.scrollHeight,
                behavior: 'smooth'
            });
        }, 100);
    }

    async function skipProcessing() {
        if (state.processing) return;

        let confirmed = true;
        if (state.pendingRenames.length > 0) {
            confirmed = await ui.showModal(
                'Skip Renaming',
                `Keep the current filenames and continue to organization? ${state.pendingRenames.length} generated rename suggestion${state.pendingRenames.length !== 1 ? 's' : ''} will be discarded.`
            );
        }
        if (!confirmed) return;

        clearRenameSuggestions();
        await prepareOrganizeOptions();
        ui.showToast('Keeping current filenames. Choose an organize mode.', 'success');

        setTimeout(() => {
            el.container.scrollTo({
                top: el.container.scrollHeight,
                behavior: 'smooth'
            });
        }, 100);
    }

    async function organizeByTags() {
        if (state.selectedTags.size === 0) return;

        const confirmed = await ui.showModal(
            'Confirm Organization',
            `Are you sure you want to organize images into ${state.selectedTags.size} folder${state.selectedTags.size !== 1 ? 's' : ''}? This will move images on your filesystem.`
        );
        if (!confirmed) return;

        setOrganizeBusy(true);
        ui.setButtonLoading(el.organizeByTagsBtn, el.organizeByTagsIcon, el.organizeByTagsText, 'Organizing...');

        const moves = [];
        const processedFiles = new Set();

        for (const tag of state.selectedTags) {
            const files = state.tagData[tag];
            if (!files) continue;
            for (let i = 0; i < files.length; i++) {
                const fileName = files[i];
                if (!processedFiles.has(fileName)) {
                    moves.push({ file_name: fileName, target_folder: tag });
                    processedFiles.add(fileName);
                }
            }
        }

        try {
            const results = await invoke('organize_by_tags', {
                folder: el.folderPath.value,
                moves: moves
            });
            handleOrganizeResults(results);
        } catch (error) {
            ui.showToast('Failed to organize files: ' + error, 'error');
        }

        ui.resetOrganizeButtons();
        setOrganizeBusy(false);
    }

    async function organizeAllImages() {
        const fileNames = collectFileNames();
        if (fileNames.length === 0) return;

        const confirmed = await ui.showModal(
            'Confirm Organization',
            'Move all images into the Images folder? This will move images on your filesystem.'
        );
        if (!confirmed) return;

        setOrganizeBusy(true);
        ui.setButtonLoading(el.organizeImagesBtn, el.organizeImagesIcon, el.organizeImagesText, 'Organizing...');

        try {
            const results = await invoke('organize_all_to_folder', {
                folder: el.folderPath.value,
                fileNames,
                targetFolder: 'Images'
            });
            handleOrganizeResults(results);
        } catch (error) {
            ui.showToast('Failed to organize files: ' + error, 'error');
        }

        ui.resetOrganizeButtons();
        setOrganizeBusy(false);
    }

    async function organizeByTimeline() {
        const fileNames = collectFileNames();
        if (fileNames.length === 0) return;
        const groupingLabels = {
            year: 'year folders',
            month: 'month folders',
            year_month: 'year/month folders'
        };

        const confirmed = await ui.showModal(
            'Confirm Organization',
            `Group images into ${groupingLabels[state.selectedTimelineGrouping] || 'timeline folders'} based on file modified time? This will move images on your filesystem.`
        );
        if (!confirmed) return;

        setOrganizeBusy(true);
        ui.setButtonLoading(el.organizeTimelineBtn, el.organizeTimelineIcon, el.organizeTimelineText, 'Organizing...');

        try {
            const results = await invoke('organize_by_time', {
                folder: el.folderPath.value,
                fileNames,
                grouping: state.selectedTimelineGrouping
            });
            handleOrganizeResults(results);
        } catch (error) {
            ui.showToast('Failed to organize files: ' + error, 'error');
        }

        ui.resetOrganizeButtons();
        setOrganizeBusy(false);
    }

    function skipOrganize() {
        el.organizeCard.classList.add('disabled');
        ui.collapseCard(el.organizeCard);
        resetOrganizeFlow();
        ui.showToast('Organization skipped.', 'success');
    }

    async function openGitHub() {
        await openUrl('https://github.com/crsxmilitaru/pictag');
    }

    async function checkForUpdates() {
        const updateBtn = /** @type {HTMLButtonElement} */ (document.getElementById('updateBtn'));
        const updateIcon = /** @type {HTMLElement} */ (document.getElementById('updateIcon'));
        const updateText = /** @type {HTMLElement} */ (document.getElementById('updateText'));

        try {
            updateBtn.disabled = true;
            updateIcon.innerHTML = '<div class="spinner"></div>';
            updateText.textContent = 'Checking...';

            const update = await check();

            if (update) {
                updateText.textContent = `Update available: v${update.version || ''}`;
                updateIcon.innerHTML = '<i class="fa-solid fa-download"></i>';
                updateBtn.disabled = false;

                updateBtn.onclick = async () => {
                    try {
                        updateBtn.disabled = true;
                        updateIcon.innerHTML = '<div class="spinner"></div>';
                        updateText.textContent = 'Installing...';

                        await update.downloadAndInstall();
                        await relaunch();
                    } catch (err) {
                        ui.showToast('Failed to install update: ' + err, 'error');
                        updateBtn.disabled = false;
                        updateText.textContent = 'Retry Install';
                        updateIcon.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
                    }
                };
            } else {
                updateText.textContent = 'Up to date';
                updateIcon.innerHTML = '<i class="fa-solid fa-check"></i>';
                updateBtn.disabled = false;
                setTimeout(() => {
                    updateText.textContent = 'Check for Updates';
                    updateIcon.innerHTML = '<i class="fa-solid fa-rotate"></i>';
                    updateBtn.onclick = checkForUpdates;
                }, 3000);
            }
        } catch (error) {
            ui.showToast('Failed to check for updates: ' + error, 'error');
            updateBtn.disabled = false;
            updateText.textContent = 'Check for Updates';
            updateIcon.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        }
    }

    return {
        loadModels,
        pickFolder,
        scanFolder,
        generateNames,
        stopRecognition,
        applyChanges,
        skipProcessing,
        selectOrganizeMode,
        selectTimelineGrouping,
        organizeByTags,
        organizeAllImages,
        organizeByTimeline,
        checkForUpdates,
        skipOrganize,
        openGitHub
    };
}
