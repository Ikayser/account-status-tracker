/**
 * Account Status Tracker - Backend Server
 * Express API with SQLite database for survey collection and dashboard display
 */

const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

// Simple SQLite-like storage using JSON file
const DB_FILE = path.join(__dirname, 'tracker_data.json');

// Initialize database
function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({
            clients: [],
            responses: [],
            nextClientId: 1,
            nextResponseId: 1
        }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Utility functions
function getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split('T')[0];
}

function getColorCode(avg) {
    if (avg === null || avg === undefined) return 'none';
    if (avg < 1.5) return 'red';
    if (avg < 2.5) return 'orange';
    if (avg < 3.5) return 'blue';
    return 'green';
}

function getInvertedColorCode(avg) {
    if (avg === null || avg === undefined) return 'none';
    if (avg <= 1.5) return 'green';
    if (avg <= 2.5) return 'blue';
    if (avg <= 3.5) return 'orange';
    return 'red';
}

// Request body parser
async function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

// CORS headers
function setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// API Routes
const routes = {
    // GET /api/clients - Get all active clients
    'GET /api/clients': (req, res, db) => {
        const clients = db.clients
            .filter(c => c.active)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => ({ id: c.id, name: c.name }));
        sendJSON(res, clients);
    },

    // GET /api/clients/all - Get all clients (admin)
    'GET /api/clients/all': (req, res, db) => {
        const clients = db.clients
            .sort((a, b) => a.name.localeCompare(b.name));
        sendJSON(res, clients);
    },

    // POST /api/clients - Add new client
    'POST /api/clients': async (req, res, db) => {
        const body = await parseBody(req);
        const name = (body.name || '').trim();

        if (!name) {
            return sendJSON(res, { error: 'Client name required' }, 400);
        }

        if (db.clients.some(c => c.name.toLowerCase() === name.toLowerCase())) {
            return sendJSON(res, { error: 'Client already exists' }, 409);
        }

        const client = {
            id: db.nextClientId++,
            name,
            active: true,
            created_at: new Date().toISOString()
        };
        db.clients.push(client);
        saveDB(db);
        sendJSON(res, { id: client.id, name: client.name }, 201);
    },

    // PUT /api/clients/:id - Update client
    'PUT /api/clients': async (req, res, db, params) => {
        const id = parseInt(params.id);
        const body = await parseBody(req);
        const client = db.clients.find(c => c.id === id);

        if (!client) {
            return sendJSON(res, { error: 'Client not found' }, 404);
        }

        if (body.name !== undefined) client.name = body.name;
        if (body.active !== undefined) client.active = body.active;

        saveDB(db);
        sendJSON(res, { success: true });
    },

    // DELETE /api/clients/:id - Soft delete client
    'DELETE /api/clients': (req, res, db, params) => {
        const id = parseInt(params.id);
        const client = db.clients.find(c => c.id === id);

        if (client) {
            client.active = false;
            saveDB(db);
        }
        sendJSON(res, { success: true });
    },

    // POST /api/survey - Submit survey responses
    'POST /api/survey': async (req, res, db) => {
        const body = await parseBody(req);
        const email = (body.email || '').trim();
        const responses = body.responses || [];

        if (!email) {
            return sendJSON(res, { error: 'Email required' }, 400);
        }
        if (!responses.length) {
            return sendJSON(res, { error: 'No responses provided' }, 400);
        }

        const weekStart = getWeekStart();

        responses.forEach(resp => {
            db.responses.push({
                id: db.nextResponseId++,
                email,
                client_id: resp.client_id,
                objective_clarity: resp.objective_clarity,
                next_week_plan: resp.next_week_plan,
                resourcing_load: resp.resourcing_load,
                momentum: resp.momentum,
                quality: resp.quality,
                organic_growth: resp.organic_growth,
                week_start: weekStart,
                submitted_at: new Date().toISOString()
            });
        });

        saveDB(db);
        sendJSON(res, { success: true, count: responses.length }, 201);
    },

    // GET /api/dashboard - Get dashboard data
    'GET /api/dashboard': (req, res, db, params, query) => {
        const week = query.week || getWeekStart();
        const activeClients = db.clients
            .filter(c => c.active)
            .sort((a, b) => a.name.localeCompare(b.name));

        const dashboardData = [];

        activeClients.forEach(client => {
            const clientResponses = db.responses.filter(
                r => r.client_id === client.id && r.week_start === week
            );

            if (clientResponses.length > 0) {
                const avg = field => {
                    const vals = clientResponses.map(r => r[field]).filter(v => v != null);
                    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                };

                const avgClarity = avg('objective_clarity');
                const avgPlan = avg('next_week_plan');
                const avgBurn = avg('resourcing_load');
                const avgMomentum = avg('momentum');
                const avgQuality = avg('quality');
                const avgGrowth = avg('organic_growth');

                dashboardData.push({
                    client_id: client.id,
                    client_name: client.name,
                    response_count: clientResponses.length,
                    metrics: {
                        clarity: { avg: avgClarity ? +avgClarity.toFixed(2) : null, color: getColorCode(avgClarity) },
                        plan: { avg: avgPlan ? +avgPlan.toFixed(2) : null, color: getColorCode(avgPlan) },
                        burn: { avg: avgBurn ? +avgBurn.toFixed(2) : null, color: getInvertedColorCode(avgBurn) },
                        momentum: { avg: avgMomentum ? +avgMomentum.toFixed(2) : null, color: getColorCode(avgMomentum) },
                        quality: { avg: avgQuality ? +avgQuality.toFixed(2) : null, color: getColorCode(avgQuality) },
                        growth: { avg: avgGrowth ? +avgGrowth.toFixed(2) : null, color: getColorCode(avgGrowth) }
                    }
                });
            }
        });

        sendJSON(res, { week, clients: dashboardData });
    },

    // GET /api/dashboard/weeks - Get available weeks
    'GET /api/dashboard/weeks': (req, res, db) => {
        const weeks = [...new Set(db.responses.map(r => r.week_start))]
            .sort((a, b) => b.localeCompare(a));
        sendJSON(res, weeks);
    },

    // GET /api/admin/responses - Get detailed responses
    'GET /api/admin/responses': (req, res, db, params, query) => {
        const week = query.week || getWeekStart();
        const clientId = query.client_id ? parseInt(query.client_id) : null;

        let responses = db.responses.filter(r => r.week_start === week);
        if (clientId) {
            responses = responses.filter(r => r.client_id === clientId);
        }

        const result = responses.map(r => {
            const client = db.clients.find(c => c.id === r.client_id);
            return {
                ...r,
                client_name: client ? client.name : 'Unknown'
            };
        }).sort((a, b) => {
            const nameCompare = a.client_name.localeCompare(b.client_name);
            if (nameCompare !== 0) return nameCompare;
            return new Date(b.submitted_at) - new Date(a.submitted_at);
        });

        sendJSON(res, result);
    },

    // GET /api/admin/stats - Get admin statistics
    'GET /api/admin/stats': (req, res, db, params, query) => {
        const week = query.week || getWeekStart();
        const weekResponses = db.responses.filter(r => r.week_start === week);

        const uniqueEmails = new Set(weekResponses.map(r => r.email));
        const uniqueClients = new Set(weekResponses.map(r => r.client_id));
        const totalActiveClients = db.clients.filter(c => c.active).length;

        sendJSON(res, {
            week,
            unique_respondents: uniqueEmails.size,
            clients_covered: uniqueClients.size,
            total_active_clients: totalActiveClients,
            total_responses: weekResponses.length
        });
    }
};

// HTTP Server
const server = http.createServer(async (req, res) => {
    setCORSHeaders(res);

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    const db = initDB();
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const pathname = urlObj.pathname;
    const query = Object.fromEntries(urlObj.searchParams);

    // Match route patterns
    let params = {};
    let routeKey = `${req.method} ${pathname}`;

    // Check for parameterized routes
    if (pathname.match(/^\/api\/clients\/\d+$/)) {
        const id = pathname.split('/').pop();
        params.id = id;
        routeKey = `${req.method} /api/clients`;
    }

    const handler = routes[routeKey];

    if (handler) {
        try {
            await handler(req, res, db, params, query);
        } catch (error) {
            console.error('Error:', error);
            sendJSON(res, { error: 'Internal server error' }, 500);
        }
    } else if (pathname === '/' || pathname === '/index.html') {
        // Serve the HTML frontend
        const htmlPath = path.join(__dirname, 'index.html');
        if (fs.existsSync(htmlPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(fs.readFileSync(htmlPath, 'utf8'));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('index.html not found');
        }
    } else {
        sendJSON(res, { error: 'Not found' }, 404);
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('Account Status Tracker Server');
    console.log('='.repeat(50));
    console.log(`Data file: ${path.resolve(DB_FILE)}`);
    console.log(`Server running at: http://localhost:${PORT}`);
    console.log('='.repeat(50));
});
