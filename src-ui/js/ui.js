export function initUI(el) {
    // Toast notifications
    const toast = document.getElementById('toast');
    const toastIcon = toast.querySelector('.toast-icon');
    const toastMessage = toast.querySelector('.toast-message');
    let toastTimeout = null;

    function showToast(message, type = 'success') {
        if (toastTimeout) clearTimeout(toastTimeout);

        toast.className = 'toast ' + type;
        toastIcon.className = 'fa-solid toast-icon ' + (type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle');
        toastMessage.textContent = message;

        el.container.scrollTo({ top: 0, behavior: 'smooth' });

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }

    // Modal dialog
    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modalConfirmBtn = document.getElementById('modalConfirmBtn');
    let modalResolve = null;

    function showModal(title, body) {
        return new Promise((resolve) => {
            modalTitle.textContent = title;
            modalBody.textContent = body;
            modalOverlay.classList.add('show');
            modalResolve = resolve;

            modalConfirmBtn.onclick = () => {
                if (modalResolve) {
                    modalResolve(true);
                    modalResolve = null;
                }
                modalOverlay.classList.remove('show');
            };
        });
    }

    function closeModal() {
        modalOverlay.classList.remove('show');
        if (modalResolve) {
            modalResolve(false);
            modalResolve = null;
        }
    }

    // Card collapse/expand
    function toggleCard(header) {
        const card = header.closest('.card');
        const content = card.querySelector('.card-content');
        const icon = card.querySelector('.collapse-icon');

        const isCollapsed = content.classList.toggle('collapsed');
        icon.classList.toggle('collapsed', isCollapsed);
    }

    function expandCard(card) {
        const content = card.querySelector('.card-content');
        const icon = card.querySelector('.collapse-icon');
        content.classList.remove('collapsed');
        icon.classList.remove('collapsed');
    }

    function collapseCard(card) {
        const content = card.querySelector('.card-content');
        const icon = card.querySelector('.collapse-icon');
        content.classList.add('collapsed');
        icon.classList.add('collapsed');
    }

    // Dropdown
    function toggleDropdown() {
        const trigger = el.modelDropdown.querySelector('.dropdown-trigger');
        const isOpen = el.dropdownOptions.classList.toggle('show');
        trigger.classList.toggle('active');

        const card = el.modelDropdown.closest('.card');
        if (card) card.style.zIndex = isOpen ? '100' : '';
    }

    function selectModel(model) {
        const trigger = el.modelDropdown.querySelector('.dropdown-trigger');
        el.selectedModel.textContent = model || "Select a model...";
        el.modelSelect.value = model;

        el.dropdownOptions.querySelectorAll('.dropdown-option').forEach(opt => {
            const isSelected = opt.querySelector('span')?.textContent === model;
            opt.classList.toggle('selected', isSelected);
        });

        el.dropdownOptions.classList.remove('show');
        trigger.classList.remove('active');

        const card = el.modelDropdown.closest('.card');
        if (card) card.style.zIndex = '';

        localStorage.setItem('selectedModel', model);
    }

    // Button helpers
    function setButtonLoading(button, iconEl, textEl, text) {
        button.disabled = true;
        iconEl.innerHTML = '<div class="spinner"></div>';
        textEl.textContent = text;
    }

    function resetButton(button, iconEl, textEl, iconHtml, text) {
        button.disabled = false;
        iconEl.innerHTML = iconHtml;
        textEl.textContent = text;
    }

    function resetOrganizeButtons() {
        resetButton(el.organizeByTagsBtn, el.organizeByTagsIcon, el.organizeByTagsText, '<i class="fa-solid fa-folder-plus"></i>', 'Organize by Tags');
        resetButton(el.organizeImagesBtn, el.organizeImagesIcon, el.organizeImagesText, '<i class="fa-solid fa-images"></i>', 'Move to Images');
        resetButton(el.organizeTimelineBtn, el.organizeTimelineIcon, el.organizeTimelineText, '<i class="fa-solid fa-calendar-plus"></i>', 'Organize by Timeline');
    }

    // Utility functions
    function stripExtension(filename) {
        return filename.replace(/\.[^/.]+$/, "");
    }

    function baseName(path) {
        const parts = path.split(/[\\/]/);
        return parts[parts.length - 1] || path;
    }

    function displayName(path) {
        return stripExtension(baseName(path));
    }

    return {
        showToast,
        showModal,
        closeModal,
        toggleCard,
        expandCard,
        collapseCard,
        toggleDropdown,
        selectModel,
        setButtonLoading,
        resetButton,
        resetOrganizeButtons,
        displayName
    };
}
