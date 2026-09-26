const SUPABASE_URL = 'https://iwtuwtvgrocmxfkmidlk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3dHV3dHZncm9jbXhma21pZGxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNTM5NzUsImV4cCI6MjA5MzkyOTk3NX0.ISCfQxrD4dAnygL-teYon-KoJWrzDuTEHFZpe9tslmY';

let supabaseClient = null;
if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
    console.warn("Supabase n'a pas pu être chargé (bloqueur de pub ?). Mode hors-ligne activé pour l'interface.");
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const modal = document.getElementById('recipeModal');
        const viewModal = document.getElementById('viewRecipeModal');
        const addBtn = document.getElementById('addRecipeBtn');
        const closeBtn = document.querySelector('.close-btn');
        const viewCloseBtn = document.querySelector('.view-close-btn');
        const form = document.getElementById('recipeForm');
        const recipesGrid = document.getElementById('recipesGrid');
        
        const searchInput = document.getElementById('searchInput');
        const typeFilter = document.getElementById('typeFilter');

        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        const imageInput = document.getElementById('recipeImage');
        const imagePreview = document.getElementById('imagePreview');
        
        let recipes = [];
        let editingId = null;
        let currentImageUrl = null;
        let newImageFile = null;

        // Initialisation terminée
        
        async function loadRecipes() {
            if (!supabaseClient) {
                recipesGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--accent);">Impossible de charger les recettes (connexion bloquée).</p>`;
                return;
            }

            recipesGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                <p>Chargement des recettes en cours...</p>
            </div>`;

            const { data, error } = await supabaseClient
                .from('recipes')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Erreur Supabase:', error);
                recipesGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--accent);">Erreur lors du chargement des recettes: ${error.message}</p>`;
                return;
            }

            recipes = data || [];
            renderRecipes();
        }

        addBtn.addEventListener('click', () => {
            editingId = null;
            form.reset();
            document.getElementById('modalTitle').innerText = 'Ajouter une recette';
            currentImageUrl = null;
            newImageFile = null;
            imagePreview.innerHTML = '';
            
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            document.querySelector('[data-tab="text-tab"]').classList.add('active');
            document.getElementById('text-tab').classList.add('active');

            modal.classList.remove('hidden');
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        viewCloseBtn.addEventListener('click', () => {
            viewModal.classList.add('hidden');
        });

        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
            if (e.target === viewModal) {
                viewModal.classList.add('hidden');
            }
        });

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        imageInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                newImageFile = file;
                const reader = new FileReader();
                reader.onload = function(event) {
                    imagePreview.innerHTML = `<img src="${event.target.result}" alt="Aperçu avant upload">`;
                };
                reader.readAsDataURL(file);
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!supabaseClient) {
                alert("Sauvegarde impossible, base de données non connectée.");
                return;
            }
            
            const submitBtn = form.querySelector('.submit-btn');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement en cours...';

            let finalImageUrl = currentImageUrl;

            if (newImageFile) {
                const fileExt = newImageFile.name.split('.').pop();
                const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
                
                const { data: uploadData, error: uploadError } = await supabaseClient.storage
                    .from('recipe-images')
                    .upload(fileName, newImageFile);
                
                if (uploadError) {
                    console.error('Erreur upload:', uploadError);
                    alert("Erreur lors de l'upload de l'image.");
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Enregistrer';
                    return;
                }
                
                const { data } = supabaseClient.storage.from('recipe-images').getPublicUrl(fileName);
                finalImageUrl = data.publicUrl;
            }

            const keywordsStr = document.getElementById('recipeKeywords').value;
            const keywordsArray = keywordsStr ? keywordsStr.split(',').map(k => k.trim()).filter(k => k) : [];

            const recipeData = {
                title: document.getElementById('recipeTitle').value,
                type: document.getElementById('recipeType').value,
                keywords: keywordsArray,
                content: document.getElementById('recipeContent').value,
                url: document.getElementById('recipeUrl').value,
                image_url: finalImageUrl
            };

            if (editingId) {
                const { error } = await supabaseClient
                    .from('recipes')
                    .update(recipeData)
                    .eq('id', editingId);
                    
                if (error) console.error('Erreur de modification:', error);
            } else {
                const { error } = await supabaseClient
                    .from('recipes')
                    .insert([recipeData]);
                    
                if (error) console.error('Erreur d\'ajout:', error);
            }

            await loadRecipes();
            modal.classList.add('hidden');
            
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Enregistrer';
        });

        searchInput.addEventListener('input', renderRecipes);
        typeFilter.addEventListener('change', renderRecipes);

        function renderRecipes() {
            const searchTerm = searchInput.value.toLowerCase();
            const filterType = typeFilter.value;

            const filteredRecipes = recipes.filter(recipe => {
                const matchesSearch = recipe.title.toLowerCase().includes(searchTerm) || 
                                    (recipe.keywords && recipe.keywords.some(k => k.toLowerCase().includes(searchTerm))) ||
                                    (recipe.content && recipe.content.toLowerCase().includes(searchTerm));
                const matchesType = filterType === 'all' || recipe.type === filterType;
                return matchesSearch && matchesType;
            });

            recipesGrid.innerHTML = '';

            if (filteredRecipes.length === 0) {
                recipesGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">
                    <i class="fa-solid fa-book-open" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p>Aucune recette trouvée.</p>
                </div>`;
                return;
            }

            filteredRecipes.forEach(recipe => {
                const card = document.createElement('div');
                card.className = 'recipe-card';
                
                const typeLabels = {
                    'entree': 'Entrée',
                    'plat': 'Plat principal',
                    'dessert': 'Dessert',
                    'boisson': 'Boisson'
                };

                let mediaHTML = '';
                if (recipe.image_url) {
                    mediaHTML = `<img src="${recipe.image_url}" class="recipe-image-thumb" alt="Photo de la recette">`;
                } else if (recipe.url) {
                    mediaHTML = `<div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 0.5rem; margin-bottom: 0.5rem; text-align: center;">
                        <i class="fa-solid fa-link" style="color: var(--accent); font-size: 2rem; margin-bottom: 0.5rem;"></i>
                        <p style="font-size: 0.8rem; color: var(--text-muted); word-break: break-all;">${recipe.url}</p>
                    </div>`;
                }

                let keywordsHTML = '';
                if (recipe.keywords && recipe.keywords.length > 0) {
                    keywordsHTML = recipe.keywords.map(k => `<span class="keyword-tag">${k}</span>`).join('');
                }

                card.innerHTML = `
                    <span class="recipe-type">${typeLabels[recipe.type] || recipe.type}</span>
                    <h3 class="recipe-title" style="cursor:pointer;" title="Voir la recette">${recipe.title}</h3>
                    <div style="cursor:pointer;" title="Voir la recette">
                        ${mediaHTML}
                    </div>
                    <div class="recipe-keywords">${keywordsHTML}</div>
                    <p class="recipe-preview" style="cursor:pointer;" title="Voir la recette">${recipe.content ? recipe.content : (recipe.url ? 'Recette via lien externe' : 'Recette via photo')}</p>
                    <div class="recipe-actions">
                        <button class="icon-btn edit-btn" title="Modifier"><i class="fa-solid fa-pen" style="font-size: 0.9rem;"></i></button>
                        ${recipe.url ? `<a href="${recipe.url}" target="_blank" class="icon-btn" title="Ouvrir le lien"><i class="fa-solid fa-external-link-alt" style="font-size: 0.9rem;"></i></a>` : ''}
                        <button class="icon-btn delete-btn" title="Supprimer" style="margin-left: auto; color: #f43f5e;"><i class="fa-solid fa-trash" style="font-size: 0.9rem;"></i></button>
                    </div>
                `;

                // Clic pour voir la recette (sur le titre, l'image ou le texte)
                const openViewModal = () => {
                    document.getElementById('viewModalTitle').innerText = recipe.title;
                    document.getElementById('viewModalType').innerText = typeLabels[recipe.type] || recipe.type;
                    
                    const keywordsContainer = document.getElementById('viewModalKeywords');
                    if (recipe.keywords && recipe.keywords.length > 0) {
                        keywordsContainer.innerHTML = recipe.keywords.map(k => `<span class="keyword-tag">${k}</span>`).join('');
                        keywordsContainer.style.display = 'flex';
                    } else {
                        keywordsContainer.innerHTML = '';
                        keywordsContainer.style.display = 'none';
                    }

                    const contentArea = document.getElementById('viewModalContentArea');
                    let contentHTML = '';

                    if (recipe.image_url) {
                        contentHTML += `<img src="${recipe.image_url}" style="width: 100%; border-radius: 0.5rem; margin-bottom: 1rem; object-fit: contain; max-height: 500px;" alt="Photo de la recette">`;
                    }
                    if (recipe.content) {
                        contentHTML += `<div style="white-space: pre-wrap; font-size: 1.1rem; line-height: 1.6; color: var(--text-main); background: rgba(0,0,0,0.2); padding: 1.5rem; border-radius: 0.5rem; margin-bottom: 1rem;">${recipe.content}</div>`;
                    }
                    if (recipe.url) {
                        contentHTML += `<a href="${recipe.url}" target="_blank" class="btn primary-btn" style="text-decoration: none; display: inline-flex; justify-content: center; width: 100%;"><i class="fa-solid fa-external-link-alt"></i> Consulter le site de la recette</a>`;
                    }

                    contentArea.innerHTML = contentHTML;
                    viewModal.classList.remove('hidden');
                };

                card.querySelector('.recipe-title').addEventListener('click', openViewModal);
                card.querySelector('.recipe-preview').addEventListener('click', openViewModal);
                const mediaDiv = card.querySelector('div[title="Voir la recette"]');
                if (mediaDiv) mediaDiv.addEventListener('click', openViewModal);

                card.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    editingId = recipe.id;
                    document.getElementById('modalTitle').innerText = 'Modifier la recette';
                    document.getElementById('recipeTitle').value = recipe.title;
                    document.getElementById('recipeType').value = recipe.type;
                    document.getElementById('recipeKeywords').value = recipe.keywords ? recipe.keywords.join(', ') : '';
                    document.getElementById('recipeContent').value = recipe.content || '';
                    document.getElementById('recipeUrl').value = recipe.url || '';
                    
                    currentImageUrl = recipe.image_url || null;
                    newImageFile = null;
                    document.getElementById('recipeImage').value = '';
                    imagePreview.innerHTML = currentImageUrl ? `<img src="${currentImageUrl}" alt="Aperçu">` : '';
                    
                    tabBtns.forEach(b => b.classList.remove('active'));
                    tabContents.forEach(c => c.classList.remove('active'));
                    
                    if (recipe.content) {
                        document.querySelector('[data-tab="text-tab"]').classList.add('active');
                        document.getElementById('text-tab').classList.add('active');
                    } else if (recipe.url) {
                        document.querySelector('[data-tab="url-tab"]').classList.add('active');
                        document.getElementById('url-tab').classList.add('active');
                    } else if (recipe.image_url) {
                        document.querySelector('[data-tab="image-tab"]').classList.add('active');
                        document.getElementById('image-tab').classList.add('active');
                    } else {
                        document.querySelector('[data-tab="text-tab"]').classList.add('active');
                        document.getElementById('text-tab').classList.add('active');
                    }

                    modal.classList.remove('hidden');
                });

                card.querySelector('.delete-btn').addEventListener('click', async () => {
                    if (confirm('Voulez-vous vraiment supprimer cette recette ?')) {
                        const icon = card.querySelector('.delete-btn');
                        icon.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                        
                        const { error } = await supabaseClient
                            .from('recipes')
                            .delete()
                            .eq('id', recipe.id);
                        
                        if (!error) {
                            await loadRecipes();
                        } else {
                            console.error("Erreur suppression:", error);
                            icon.innerHTML = '<i class="fa-solid fa-trash"></i>';
                        }
                    }
                });

                recipesGrid.appendChild(card);
            });
        }

        // Charger les recettes après avoir attaché tous les événements
        await loadRecipes();
    } catch (error) {
        alert("Erreur critique détectée sur la page : " + error.message);
        console.error(error);
    }
});
