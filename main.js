const express = require('express');
const appController = require('./appController');
const cookieParser = require('cookie-parser');

// Load environment variables from .env file
// Ensure your .env file has the required database credentials.
const loadEnvFile = require('./utils/envUtil');
const envVariables = loadEnvFile('./.env');

const app = express();
const PORT = envVariables.PORT || 65534;  // Adjust the PORT if needed (e.g., if you encounter a "port already occupied" error)

// Middleware setup
app.use(express.static('public'));  // Serve static files from the 'public' directory
// Parse incoming JSON payloads
app.use(express.json({
    limit: '1gb'
}));
app.use(express.urlencoded({ extended: true }));    // Parse HTML forms
app.use(cookieParser());    // Parse cookies

// mount the router
app.use('/api', appController);

// ----------------------------------------------------------
// Starting the server
(async () => {
    await appController.setupPool();
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}/`);
    });
})();
