/**
 * SIGOD Ticket Management - Vanilla JS (ES6+)
 * Senior Developer Implementation - Modular Pattern
 */

"use strict";

const TicketApp = (() => {
    // --- SUPABASE CONFIG ---
    const SUPABASE_URL = 'https://kctmikwyvpsfxbsgubjs.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_xMvwrUSzwdIEnDM-6QT0aQ_M28enOlj';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // --- STATE ---
    let state = {
        tickets: [],
        filters: {
            global: '',
            id: '',
            sir: '',
            start: '',
            end: '',
            pattern: '',
            origin: ''
        },
        currentFiles: [], // Store File objects for upload
        user: null
    };

    // --- DOM ELEMENTS ---
    const DOM = {
        tableBody: document.getElementById('tickets-body'),
        modal: document.getElementById('ticket-modal'),
        form: document.getElementById('ticket-form'),
        uploadZone: document.getElementById('upload-zone'),
        imageInput: document.getElementById('image-input'),
        previewGallery: document.getElementById('preview-gallery'),
        stats: {
            open: document.getElementById('count-open'),
            process: document.getElementById('count-process'),
            done: document.getElementById('count-done')
        },
        toast: document.getElementById('notification-toast'),
        noResults: document.getElementById('no-results'),
        loginScreen: document.getElementById('login-screen'),
        appContainer: document.getElementById('app-container'),
        loginForm: document.getElementById('login-form'),
        loginError: document.getElementById('login-error')
    };

    // --- STORAGE MODULE (SUPABASE) ---
    const Storage = {
        async fetchTickets() {
            const { data, error } = await supabase
                .from('tickets')
                .select('*, ticket_attachments(*) ')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching tickets:', error);
                return [];
            }
            return data;
        },

        async uploadFile(file) {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `ticket-attachments/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('ticket-files')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data } = supabase.storage
                .from('ticket-files')
                .getPublicUrl(filePath);

            return {
                url: data.publicUrl,
                path: filePath,
                name: file.name,
                type: file.type
            };
        }
    };

    // --- CORE LOGIC ---
    const Logic = {
        generateSIR() {
            // This could also be handled by a DB function for real sequence
            const lastTicket = state.tickets[0]; // Since they are ordered by created_at desc
            const nextId = lastTicket ? (state.tickets.length + 1) : 1;
            return `SIR${String(nextId).padStart(7, '0')}`;
        },

        async addTicket(ticketData) {
            const sirNumber = ticketData.sir || this.generateSIR();

            // 1. Insert Ticket
            const { data: ticket, error } = await supabase
                .from('tickets')
                .insert([{
                    ticket_number: sirNumber,
                    title: ticketData.title,
                    description: ticketData.description,
                    status: ticketData.status,
                    assignee: ticketData.assignee || 'Sin asignar',
                    pattern: ticketData.pattern || '-',
                    origin: ticketData.origin || '-',
                    completed_at: ticketData.status === 'Finalizado' ? new Date().toISOString() : null
                }])
                .select()
                .single();

            if (error) throw error;

            // 2. Upload Files if any
            if (state.currentFiles.length > 0) {
                for (const file of state.currentFiles) {
                    const uploadInfo = await Storage.uploadFile(file);
                    await supabase.from('ticket_attachments').insert([{
                        ticket_id: ticket.id,
                        file_name: uploadInfo.name,
                        file_path: uploadInfo.path,
                        file_type: uploadInfo.type
                    }]);
                }
            }

            Notify.show('Ticket Creado', `Se ha generado el ticket ${sirNumber}`);
            return ticket;
        },

        async updateTicket(id, updates) {
            const { error } = await supabase
                .from('tickets')
                .update({
                    ticket_number: updates.sir,
                    title: updates.title,
                    description: updates.description,
                    status: updates.status,
                    assignee: updates.assignee,
                    pattern: updates.pattern,
                    origin: updates.origin,
                    completed_at: updates.status === 'Finalizado' ? new Date().toISOString() : null
                })
                .eq('id', id);

            if (error) throw error;
            Notify.show('Ticket Actualizado', `Cambios guardados correctamente.`);
            return true;
        },

        async deleteTicket(id) {
            const { error } = await supabase.from('tickets').delete().eq('id', id);
            if (error) throw error;
            Notify.show('Ticket Eliminado', 'El registro ha sido removido.');
        }
    };

    // --- AUTH MODULE ---
    const Auth = {
        async hashPassword(password) {
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        },

        async handleLogin(e) {
            e.preventDefault();
            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value.trim();
            DOM.loginError.style.display = 'none';

            try {
                const hashedPassword = await this.hashPassword(password);
                const { data: user, error } = await supabase
                    .from('users')
                    .select('id, username, full_name')
                    .eq('username', username)
                    .eq('password_hash', hashedPassword)
                    .single();

                if (error) {
                    if (error.code === 'PGRST116') {
                        DOM.loginError.textContent = 'Usuario o contraseña incorrectos.';
                    } else {
                        throw error;
                    }
                    DOM.loginError.style.display = 'block';
                    return;
                }

                if (user) {
                    sessionStorage.setItem('kanban_user', JSON.stringify(user));
                    state.user = user;
                    this.showApp();
                }
            } catch (err) {
                console.error('Error detallado:', err);
                DOM.loginError.textContent = `Error: ${err.message || 'Error de conexión.'}`;
                DOM.loginError.style.display = 'block';
            }
        },

        showApp() {
            document.body.classList.remove('auth-mode');
            DOM.loginScreen.style.display = 'none';
            DOM.appContainer.style.display = 'flex';
            
            // Update user info in UI
            if (state.user) {
                const avatar = document.querySelector('.avatar');
                if (avatar) avatar.textContent = state.user.full_name.charAt(0);
            }

            TicketApp.loadData();
        },

        checkSession() {
            const savedUser = sessionStorage.getItem('kanban_user');
            if (savedUser) {
                state.user = JSON.parse(savedUser);
                this.showApp();
                return true;
            }
            return false;
        },

        logout() {
            sessionStorage.removeItem('kanban_user');
            window.location.reload();
        }
    };

    // --- UI CONTROLLER ---
    const UI = {
        render() {
            const filtered = UI.getFilteredTickets();

            DOM.tableBody.innerHTML = '';

            if (filtered.length === 0) {
                DOM.noResults.style.display = 'block';
            } else {
                DOM.noResults.style.display = 'none';
                filtered.forEach(ticket => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>#${String(ticket.id).substring(0, 5)}...</td>
                        <td><strong>${ticket.ticket_number}</strong></td>
                        <td><span class="status-badge badge-${this.getStatusClass(ticket.status)}">${ticket.status}</span></td>
                        <td>${new Date(ticket.created_at).toLocaleDateString()}</td>
                        <td>${ticket.pattern}</td>
                        <td>${ticket.origin}</td>
                        <td>${ticket.assignee}</td>
                        <td>
                            <div class="action-btns">
                                <button class="icon-btn edit-btn" data-id="${ticket.id}" title="Editar">✏️</button>
                                <button class="icon-btn delete-btn" data-id="${ticket.id}" title="Eliminar">🗑️</button>
                            </div>
                        </td>
                    `;
                    tr.addEventListener('click', (e) => {
                        // Don't trigger if an action button was clicked
                        if (e.target.closest('.action-btns')) return;
                        UI.openModal(ticket.id, true);
                    });
                    DOM.tableBody.appendChild(tr);
                });
            }
            this.updateStats();
        },

        getStatusClass(status) {
            if (status === 'Abierto') return 'open';
            if (status === 'En Proceso') return 'process';
            return 'done';
        },

        updateStats() {
            DOM.stats.open.textContent = state.tickets.filter(t => t.status === 'Abierto').length;
            DOM.stats.process.textContent = state.tickets.filter(t => t.status === 'En Proceso').length;
            DOM.stats.done.textContent = state.tickets.filter(t => t.status === 'Finalizado').length;
        },

        getFilteredTickets() {
            return state.tickets.filter(t => {
                const matchesGlobal = !state.filters.global ||
                    t.ticket_number.toLowerCase().includes(state.filters.global.toLowerCase()) ||
                    t.title.toLowerCase().includes(state.filters.global.toLowerCase()) ||
                    t.pattern.toLowerCase().includes(state.filters.global.toLowerCase());

                const matchesSir = !state.filters.sir || t.ticket_number.toLowerCase().includes(state.filters.sir.toLowerCase());
                const matchesPattern = !state.filters.pattern || t.pattern.toLowerCase().includes(state.filters.pattern.toLowerCase());
                const matchesOrigin = !state.filters.origin || t.origin.toLowerCase().includes(state.filters.origin.toLowerCase());

                const ticketDate = new Date(t.created_at).setHours(0, 0, 0, 0);
                const matchesStart = !state.filters.start || ticketDate >= new Date(state.filters.start).setHours(0, 0, 0, 0);
                const matchesEnd = !state.filters.end || ticketDate <= new Date(state.filters.end).setHours(0, 0, 0, 0);

                return matchesGlobal && matchesSir && matchesPattern && matchesOrigin && matchesStart && matchesEnd;
            });
        },

        openModal(id = null, viewOnly = false) {
            DOM.form.reset();
            DOM.previewGallery.innerHTML = '';
            state.currentFiles = [];

            // Toggle form accessibility
            const inputs = DOM.form.querySelectorAll('input, select, textarea');
            inputs.forEach(input => input.disabled = viewOnly);
            document.getElementById('save-ticket').style.display = viewOnly ? 'none' : 'block';
            document.getElementById('upload-zone').style.display = viewOnly ? 'none' : 'block';

            if (id) {
                const ticket = state.tickets.find(t => t.id === parseInt(id) || t.id === id);
                if (ticket) {
                    document.getElementById('modal-title').textContent = viewOnly ? 'Detalles del Ticket ' + ticket.ticket_number : 'Editar Ticket ' + ticket.ticket_number;
                    document.getElementById('ticket-id-hidden').value = ticket.id;
                    document.getElementById('ticket-title').value = ticket.title;
                    document.getElementById('ticket-sir-manual').value = ticket.ticket_number;
                    document.getElementById('ticket-status').value = ticket.status;
                    document.getElementById('ticket-assignee').value = ticket.assignee;
                    document.getElementById('ticket-pattern').value = ticket.pattern;
                    document.getElementById('ticket-origin').value = ticket.origin;
                    document.getElementById('ticket-desc').value = ticket.description;

                    // Render existing attachments
                    if (ticket.ticket_attachments) {
                        ticket.ticket_attachments.forEach(att => {
                            const item = document.createElement('div');
                            item.className = 'preview-item';
                            item.innerHTML = `<span>📎 ${att.file_name}</span>`;
                            DOM.previewGallery.appendChild(item);
                        });
                    }
                }
            } else {
                document.getElementById('modal-title').textContent = 'Crear Nuevo Ticket';
                document.getElementById('ticket-id-hidden').value = '';
            }

            DOM.modal.style.display = 'block';
        },

        closeModal() {
            DOM.modal.style.display = 'none';
        },

        renderPreviews() {
            DOM.previewGallery.innerHTML = '';
            state.currentFiles.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'preview-item';
                const url = URL.createObjectURL(file);
                item.innerHTML = `
                    <img src="${url}" alt="Preview">
                    <span class="remove-img" data-index="${index}">×</span>
                `;
                DOM.previewGallery.appendChild(item);
            });
        }
    };

    // --- NOTIFICATION MODULE ---
    const Notify = {
        show(title, message) {
            console.info(`[NOTIFICACIÓN EMAIL] Para: Admin, Asunto: ${title}, Mensaje: ${message}`);

            const tTitle = document.getElementById('toast-title');
            const tMsg = document.getElementById('toast-message');

            tTitle.textContent = title;
            tMsg.textContent = message;

            DOM.toast.classList.add('show');
            setTimeout(() => DOM.toast.classList.remove('show'), 4000);
        }
    };

    // --- EXPORT MODULE ---
    const Export = {
        toCSV() {
            const filtered = UI.getFilteredTickets();
            if (filtered.length === 0) return alert('No hay datos para exportar.');

            const headers = ['ID Interno', 'Numero Ticket', 'Estado', 'Fecha Creacion', 'Fecha Finalizacion', 'Patron Ataque', 'Origen/Destino', 'Asignado', 'Descripcion'];
            const rows = filtered.map(t => [
                t.id,
                t.ticket_number,
                t.status,
                t.created_at,
                t.completed_at || '',
                `"${t.pattern}"`,
                `"${t.origin}"`,
                `"${t.assignee}"`,
                `"${t.description.replace(/"/g, '""')}"`
            ]);

            const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");

            link.setAttribute("href", url);
            link.setAttribute("download", `reporte_sigod_${new Date().getTime()}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    // --- EVENT HANDLERS ---
    const Handlers = {
        init() {
            // Modal events
            document.getElementById('open-modal-btn').onclick = () => UI.openModal();
            document.querySelector('.close-modal').onclick = () => UI.closeModal();
            document.getElementById('cancel-ticket').onclick = () => UI.closeModal();

            window.onclick = (e) => {
                if (e.target === DOM.modal) UI.closeModal();
            };

            // Form submit
            DOM.form.onsubmit = async (e) => {
                e.preventDefault();
                const btn = document.getElementById('save-ticket');
                btn.disabled = true;
                btn.textContent = 'Guardando...';

                try {
                    const id = document.getElementById('ticket-id-hidden').value;
                    const data = {
                        title: document.getElementById('ticket-title').value,
                        sir: document.getElementById('ticket-sir-manual').value,
                        status: document.getElementById('ticket-status').value,
                        assignee: document.getElementById('ticket-assignee').value,
                        pattern: document.getElementById('ticket-pattern').value,
                        origin: document.getElementById('ticket-origin').value,
                        description: document.getElementById('ticket-desc').value
                    };

                    if (id) {
                        await Logic.updateTicket(id, data);
                    } else {
                        await Logic.addTicket(data);
                    }

                    // Refresh state
                    state.tickets = await Storage.fetchTickets();
                    UI.closeModal();
                    UI.render();
                } catch (err) {
                    alert('Error al guardar: ' + err.message);
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Guardar Ticket';
                }
            };

            // Image Upload
            DOM.uploadZone.onclick = () => DOM.imageInput.click();
            DOM.imageInput.onchange = (e) => {
                const files = Array.from(e.target.files);
                state.currentFiles.push(...files);
                UI.renderPreviews();
            };

            // Remove image (only for new ones)
            DOM.previewGallery.onclick = (e) => {
                if (e.target.classList.contains('remove-img')) {
                    const index = parseInt(e.target.dataset.index);
                    state.currentFiles.splice(index, 1);
                    UI.renderPreviews();
                }
            };

            // Filtering
            document.getElementById('global-search').oninput = (e) => {
                state.filters.global = e.target.value;
                UI.render();
            };

            document.getElementById('filter-id').oninput = (e) => {
                state.filters.id = e.target.value;
                UI.render();
            };

            document.getElementById('filter-sir').oninput = (e) => {
                state.filters.sir = e.target.value;
                UI.render();
            };

            document.getElementById('filter-pattern').oninput = (e) => {
                state.filters.pattern = e.target.value;
                UI.render();
            };

            document.getElementById('filter-origin').oninput = (e) => {
                state.filters.origin = e.target.value;
                UI.render();
            };

            document.getElementById('filter-date-start').onchange = (e) => {
                state.filters.start = e.target.value;
                UI.render();
            };

            document.getElementById('filter-date-end').onchange = (e) => {
                state.filters.end = e.target.value;
                UI.render();
            };

            document.getElementById('clear-filters').onclick = () => {
                state.filters = { global: '', id: '', sir: '', start: '', end: '', pattern: '', origin: '' };
                document.querySelectorAll('.filter-grid input, #global-search').forEach(i => i.value = '');
                UI.render();
            };

            // Export
            document.getElementById('export-csv-btn').onclick = () => Export.toCSV();

            // Auth Events
            DOM.loginForm.onsubmit = (e) => Auth.handleLogin(e);
            
            const logoutLogic = (e) => {
                e.preventDefault();
                Auth.logout();
            };
            
            document.getElementById('logout-btn').onclick = logoutLogic;
            const topLogout = document.getElementById('logout-btn-top');
            if (topLogout) topLogout.onclick = logoutLogic;

            // Mobile Toggle
            const sidebar = document.querySelector('.sidebar');
            document.getElementById('sidebar-toggle').onclick = (e) => {
                e.stopPropagation();
                sidebar.classList.toggle('active');
            };

            document.addEventListener('click', (e) => {
                if (!sidebar.contains(e.target) && sidebar.classList.contains('active')) {
                    sidebar.classList.remove('active');
                }
            });

            // Table actions (delegation)
            DOM.tableBody.onclick = async (e) => {
                const id = e.target.dataset.id;
                if (!id) return;

                if (e.target.classList.contains('edit-btn')) {
                    UI.openModal(id, false);
                } else if (e.target.classList.contains('delete-btn')) {
                    if (confirm('¿Seguro que deseas eliminar este ticket?')) {
                        await Logic.deleteTicket(id);
                        state.tickets = await Storage.fetchTickets();
                        UI.render();
                    }
                }
            };
        }
    };

    // --- PUBLIC API ---
    return {
        async init() {
            Handlers.init();
            if (!Auth.checkSession()) {
                console.log('Esperando autenticación...');
            }
        },

        async loadData() {
            state.tickets = await Storage.fetchTickets();
            UI.render();
            console.log('SIGOD Ticket System Data Loaded');
        }
    };
})();

// Start the app
document.addEventListener('DOMContentLoaded', TicketApp.init);
