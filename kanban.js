/**
 * SIGOD Kanban Board - Tickets Integration
 * Each ticket from the 'tickets' table is a task on the board.
 */

"use strict";

const KanbanApp = (() => {
    // --- SUPABASE CONFIG ---
    const SUPABASE_URL = 'https://kctmikwyvpsfxbsgubjs.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_xMvwrUSzwdIEnDM-6QT0aQ_M28enOlj';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // --- STATE ---
    let state = {
        tickets: [],
        user: null,
        draggedTicketId: null,
        originalStatus: null
    };

    // --- DOM ELEMENTS ---
    const DOM = {
        appContainer: document.getElementById('app-container'),
        loginScreen: document.getElementById('login-screen'),
        loginForm: document.getElementById('login-form'),
        loginError: document.getElementById('login-error'),
        taskModal: document.getElementById('task-modal'),
        newTaskForm: document.getElementById('new-task-form'),
        loadingOverlay: document.getElementById('loading-overlay'),
        columns: {
            "Planeado": document.querySelector('#Planeado .tasks-container'),
            "En Proceso": document.querySelector('#En_Proceso .tasks-container'),
            "Realizado": document.querySelector('#Realizado .tasks-container'),
            "Reportado": document.querySelector('#Reportado .tasks-container')
        },
        counts: {
            "Planeado": document.getElementById('count-Planeado'),
            "En Proceso": document.getElementById('count-En_Proceso'),
            "Realizado": document.getElementById('count-Realizado'),
            "Reportado": document.getElementById('count-Reportado')
        },
        search: document.getElementById('kanban-search'),
        toast: document.getElementById('notification-toast')
    };

    // --- CORE LOGIC ---
    const Logic = {
        async fetchTickets() {
            const { data, error } = await supabase
                .from('tickets')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching tickets:', error);
                return [];
            }
            return data;
        },

        async updateTicketStatus(ticketId, newStatus) {
            UI.toggleLoading(true);
            const { error } = await supabase
                .from('tickets')
                .update({ status: newStatus })
                .eq('id', ticketId);

            if (error) {
                UI.toggleLoading(false);
                throw error;
            }

            // Log activity
            const ticket = state.tickets.find(t => t.id == ticketId);
            await this.logActivity('MOVIMIENTO', ticket.ticket_number || ticket.title, `Estado cambiado a: ${newStatus}`);
            
            UI.toggleLoading(false);
            UI.showNotify('Estado Actualizado', `Ticket ${ticket.ticket_number} movido a ${newStatus}`);
        },

        async createTicket(ticketData) {
            const { data, error } = await supabase
                .from('tickets')
                .insert([ticketData])
                .select()
                .single();

            if (error) throw error;
            
            await this.logActivity('CREACIÓN', data.ticket_number, `Nuevo ticket creado en '${data.status}'`);
            return data;
        },

        async logActivity(action, ticketTitle, details) {
            const username = state.user ? (state.user.full_name || state.user.username) : 'Sistema';
            const { error } = await supabase
                .from('activity_logs')
                .insert([{
                    username: username,
                    action: action,
                    task_title: ticketTitle,
                    details: details
                }]);
            
            if (error) console.error('Error guardando log:', error);
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
                console.error('Login error:', err);
                DOM.loginError.textContent = `Error: ${err.message}`;
                DOM.loginError.style.display = 'block';
            }
        },

        showApp() {
            document.body.classList.remove('auth-mode');
            DOM.loginScreen.style.display = 'none';
            DOM.appContainer.style.display = 'flex';
            if (state.user) {
                document.getElementById('user-avatar').textContent = state.user.full_name.charAt(0);
            }
            KanbanApp.initBoard();
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
        renderBoard() {
            // Limpiar columnas
            Object.values(DOM.columns).forEach(col => { if (col) col.innerHTML = ''; });

            const searchTerm = DOM.search.value.toLowerCase();
            const filteredTickets = state.tickets.filter(t => {
                const title = (t.title || '').toLowerCase();
                const ticketNum = (t.ticket_number || '').toLowerCase();
                const desc = (t.description || '').toLowerCase();
                return title.includes(searchTerm) || ticketNum.includes(searchTerm) || desc.includes(searchTerm);
            });

            const counts = { "Planeado": 0, "En Proceso": 0, "Realizado": 0, "Reportado": 0 };

            filteredTickets.forEach(ticket => {
                const card = this.createCard(ticket);
                
                // Normalización de estados
                let status = ticket.status;
                if (status === 'Abierto') status = 'Planeado';
                if (status === 'Finalizado') status = 'Realizado';
                
                const container = DOM.columns[status];
                if (container) {
                    container.appendChild(card);
                    counts[status]++;
                }
            });

            // Actualizar contadores
            Object.keys(counts).forEach(key => {
                const countEl = DOM.counts[key];
                if (countEl) countEl.textContent = counts[key];
            });
        },

        createCard(ticket) {
            const div = document.createElement('div');
            div.className = 'task-card';
            div.draggable = true;
            div.id = `ticket-${ticket.id}`;
            div.dataset.id = ticket.id;
            div.dataset.status = ticket.status;

            // Prioridad: Si no existe en la tabla, usamos 'media' por defecto
            const priority = (ticket.priority || 'media').toLowerCase();
            const assignee = ticket.assignee || 'Sin asignar';

            div.innerHTML = `
                <div class="card-tag">#${ticket.ticket_number || ticket.id}</div>
                <h3>${ticket.title || 'Sin título'}</h3>
                <p>${ticket.description || 'Sin descripción técnica...'}</p>
                <div class="task-footer">
                    <span class="priority-tag priority-${priority}">${priority}</span>
                    <div class="assignee-info">
                        <div class="assignee-avatar">${assignee.charAt(0).toUpperCase()}</div>
                        <span>${assignee}</span>
                    </div>
                </div>
            `;

            div.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', ticket.id);
                state.draggedTicketId = ticket.id;
                state.originalStatus = ticket.status;
                div.classList.add('dragging');
            });

            div.addEventListener('dragend', () => {
                div.classList.remove('dragging');
            });

            return div;
        },

        toggleLoading(show) {
            DOM.loadingOverlay.style.display = show ? 'flex' : 'none';
        },

        showNotify(title, message) {
            document.getElementById('toast-title').textContent = title;
            document.getElementById('toast-message').textContent = message;
            DOM.toast.classList.add('show');
            setTimeout(() => DOM.toast.classList.remove('show'), 3000);
        }
    };

    // --- EVENT HANDLERS ---
    const Handlers = {
        init() {
            DOM.loginForm.addEventListener('submit', (e) => Auth.handleLogin(e));
            document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());
            document.getElementById('logout-btn-top').addEventListener('click', () => Auth.logout());

            document.getElementById('open-task-modal').addEventListener('click', () => {
                DOM.taskModal.style.display = 'block';
            });
            document.getElementById('close-modal').addEventListener('click', () => {
                DOM.taskModal.style.display = 'none';
            });
            document.getElementById('cancel-task').addEventListener('click', () => {
                DOM.taskModal.style.display = 'none';
            });

            DOM.newTaskForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                // Generar número de ticket si está vacío (formato SIRXXXXXXX)
                const lastTicket = state.tickets[0];
                const nextNum = state.tickets.length + 100;
                const sirNum = document.getElementById('task-title').value.startsWith('SIR') 
                    ? document.getElementById('task-title').value 
                    : `SIR${String(nextNum).padStart(7, '0')}`;

                const ticketData = {
                    ticket_number: sirNum,
                    title: document.getElementById('task-title').value,
                    description: document.getElementById('task-desc').value,
                    priority: document.getElementById('task-priority').value,
                    assignee: document.getElementById('task-assignee').value,
                    status: 'Planeado',
                    pattern: '-',
                    origin: '-'
                };

                try {
                    const newTicket = await Logic.createTicket(ticketData);
                    state.tickets.unshift(newTicket);
                    UI.renderBoard();
                    DOM.taskModal.style.display = 'none';
                    DOM.newTaskForm.reset();
                    UI.showNotify('Ticket Creado', `Se generó el ticket ${newTicket.ticket_number}`);
                } catch (err) {
                    alert('Error al crear ticket: ' + err.message);
                }
            });

            DOM.search.addEventListener('input', () => UI.renderBoard());

            // MSG Drop Zone
            const dropZone = document.getElementById('msg-drop-zone');
            const msgInput = document.getElementById('msg-input');
            
            dropZone.addEventListener('click', () => msgInput.click());
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('hover');
            });
            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('hover');
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('hover');
                const file = e.dataTransfer.files[0];
                if (file) handleMsgFile(file);
            });
            msgInput.addEventListener('change', (e) => {
                if (e.target.files[0]) handleMsgFile(e.target.files[0]);
            });

            async function handleMsgFile(file) {
                if (!file.name.toLowerCase().endsWith('.msg')) {
                    alert('Por favor, selecciona un archivo .msg');
                    return;
                }
                UI.showNotify('Procesando MSG', 'Extrayendo información...');
                
                try {
                    const reader = new FileReader();
                    reader.onload = async function(e) {
                        const buffer = e.target.result;
                        const msgReader = new window.MSGReader(buffer);
                        const fileData = msgReader.getFileData();
                        
                        if (fileData) {
                            document.getElementById('task-title').value = fileData.subject || "";
                            document.getElementById('task-desc').value = fileData.body || "";
                            UI.showNotify('MSG Procesado', 'Formulario autocompletado.');
                        }
                    };
                    reader.readAsArrayBuffer(file);
                } catch (err) {
                    console.error('Error parsing MSG:', err);
                    UI.showNotify('Error', 'No se pudo leer el MSG.');
                }
            }
        }
    };

    // --- DRAG & DROP ---
    window.allowDrop = (ev) => {
        ev.preventDefault();
        const container = ev.target.closest('.tasks-container');
        if (container) container.parentElement.classList.add('drag-over');
    };

    window.dragLeave = (ev) => {
        const container = ev.target.closest('.tasks-container');
        if (container) container.parentElement.classList.remove('drag-over');
    };

    window.drop = async (ev) => {
        ev.preventDefault();
        const ticketId = state.draggedTicketId;
        const targetCol = ev.target.closest('.kanban-column');
        
        if (targetCol) {
            targetCol.classList.remove('drag-over');
            const newStatus = targetCol.id.replace('_', ' ');
            const oldStatus = state.originalStatus;

            if (newStatus === oldStatus) return;

            const ticketIndex = state.tickets.findIndex(t => t.id == ticketId);
            const originalTicket = { ...state.tickets[ticketIndex] };
            state.tickets[ticketIndex].status = newStatus;
            UI.renderBoard();

            try {
                await Logic.updateTicketStatus(ticketId, newStatus);
            } catch (err) {
                state.tickets[ticketIndex] = originalTicket;
                UI.renderBoard();
                UI.showNotify('Error', 'Sincronización fallida.');
            }
        }
    };

    return {
        init() {
            Handlers.init();
            if (!Auth.checkSession()) console.log('Auth check...');
        },
        async initBoard() {
            state.tickets = await Logic.fetchTickets();
            UI.renderBoard();
        }
    };
})();

document.addEventListener('DOMContentLoaded', KanbanApp.init);