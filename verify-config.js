#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Configuration constants - Single source of truth
const CORRECT_CONFIG = {
    CLIENT_ID: '404b1dcd8562143be56b2dd81dec2270',
    APP_URL: 'https://see-it-production.up.railway.app',
    SCOPES: 'write_products,read_products',
    API_VERSION: '2026-01',
    REDIRECT_URLS: [
        'https://see-it-production.up.railway.app/auth/callback'
    ]
};

// Colors for output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m'
};

// Results tracking
let totalChecks = 0;
let passedChecks = 0;
let warnings = [];
let errors = [];

function parseToml(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const result = {};
        let currentSection = null;
        
        content.split('\n').forEach(line => {
            line = line.trim();
            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line.slice(1, -1);
                if (!result[currentSection]) result[currentSection] = {};
            } else if (line.includes('=') && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
                if (currentSection) {
                    result[currentSection][key.trim()] = value;
                } else {
                    result[key.trim()] = value;
                }
            }
        });
        return result;
    } catch (error) {
        return null;
    }
}

function checkFile(filePath, checks) {
    totalChecks++;
    console.log(`\n${colors.blue}Checking: ${filePath}${colors.reset}`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`  ${colors.red}✗ File not found${colors.reset}`);
        errors.push(`Missing file: ${filePath}`);
        return false;
    }
    
    const config = parseToml(filePath);
    if (!config) {
        console.log(`  ${colors.red}✗ Failed to parse file${colors.reset}`);
        errors.push(`Parse error: ${filePath}`);
        return false;
    }
    
    let fileValid = true;
    
    checks.forEach(check => {
        totalChecks++;
        const value = check.section ? config[check.section]?.[check.key] : config[check.key];
        const expected = check.expected;
        
        if (value === expected) {
            console.log(`  ${colors.green}✓${colors.reset} ${check.name}: ${value}`);
            passedChecks++;
        } else if (value === undefined) {
            console.log(`  ${colors.yellow}⚠${colors.reset} ${check.name}: Not found`);
            warnings.push(`${filePath}: ${check.name} not found`);
            fileValid = false;
        } else {
            console.log(`  ${colors.red}✗${colors.reset} ${check.name}: ${value} (expected: ${expected})`);
            errors.push(`${filePath}: ${check.name} mismatch`);
            fileValid = false;
        }
    });
    
    if (fileValid) passedChecks++;
    return fileValid;
}

function checkEnvironmentVariables() {
    console.log(`\n${colors.blue}Checking Railway Environment Variables${colors.reset}`);
    console.log(`  ${colors.yellow}Note: Set these in Railway dashboard${colors.reset}`);
    
    const requiredVars = [
        { name: 'SHOPIFY_API_KEY', expected: CORRECT_CONFIG.CLIENT_ID },
        { name: 'SHOPIFY_APP_URL', expected: CORRECT_CONFIG.APP_URL },
        { name: 'SCOPES', expected: CORRECT_CONFIG.SCOPES },
        { name: 'SHOPIFY_API_SECRET', expected: 'shpss_...' },
        { name: 'DATABASE_URL', expected: 'postgresql://...' },
        { name: 'IMAGE_SERVICE_BASE_URL', expected: 'https://...' },
        { name: 'IMAGE_SERVICE_TOKEN', expected: '...' }
    ];
    
    requiredVars.forEach(varConfig => {
        totalChecks++;
        const value = process.env[varConfig.name];
        
        if (!value) {
            console.log(`  ${colors.yellow}⚠${colors.reset} ${varConfig.name}: Not set locally (check Railway)`);
            warnings.push(`Environment variable ${varConfig.name} not found locally`);
        } else if (varConfig.expected.includes('...')) {
            console.log(`  ${colors.blue}ℹ${colors.reset} ${varConfig.name}: Set (value hidden)`);
            passedChecks++;
        } else if (value === varConfig.expected) {
            console.log(`  ${colors.green}✓${colors.reset} ${varConfig.name}: ${value}`);
            passedChecks++;
        } else {
            console.log(`  ${colors.red}✗${colors.reset} ${varConfig.name}: Mismatch`);
            errors.push(`Environment variable ${varConfig.name} mismatch`);
        }
    });
}

function checkThemeExtension() {
    console.log(`\n${colors.blue}Checking Theme Extension${colors.reset}`);
    
    const extensionPath = path.join('app', 'extensions', 'see-it-extension');
    const requiredFiles = [
        'shopify.extension.toml',
        'blocks/see-it-button.liquid',
        'assets/see-it-modal.css',
        'assets/see-it-modal.js',
        'locales/en.default.json'
    ];
    
    requiredFiles.forEach(file => {
        totalChecks++;
        const filePath = path.join(extensionPath, file);
        if (fs.existsSync(filePath)) {
            console.log(`  ${colors.green}✓${colors.reset} ${file}`);
            passedChecks++;
        } else {
            console.log(`  ${colors.red}✗${colors.reset} ${file} - Missing`);
            errors.push(`Missing theme extension file: ${file}`);
        }
    });
}

function printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log(`${colors.bright}CONFIGURATION VERIFICATION SUMMARY${colors.reset}`);
    console.log('='.repeat(60));
    
    const percentage = Math.round((passedChecks / totalChecks) * 100);
    const statusColor = percentage === 100 ? colors.green : percentage >= 80 ? colors.yellow : colors.red;
    
    console.log(`\n${colors.bright}Overall Status: ${statusColor}${percentage}%${colors.reset} (${passedChecks}/${totalChecks} checks passed)`);
    
    if (errors.length > 0) {
        console.log(`\n${colors.red}${colors.bright}Errors (${errors.length}):${colors.reset}`);
        errors.forEach(error => console.log(`  ${colors.red}✗${colors.reset} ${error}`));
    }
    
    if (warnings.length > 0) {
        console.log(`\n${colors.yellow}${colors.bright}Warnings (${warnings.length}):${colors.reset}`);
        warnings.forEach(warning => console.log(`  ${colors.yellow}⚠${colors.reset} ${warning}`));
    }
    
    if (errors.length === 0 && warnings.length === 0) {
        console.log(`\n${colors.green}${colors.bright}✓ All configurations are correctly set!${colors.reset}`);
    } else {
        console.log(`\n${colors.yellow}${colors.bright}Action Required:${colors.reset}`);
        console.log('1. Fix all errors (red ✗ items)');
        console.log('2. Review warnings (yellow ⚠ items)');
        console.log('3. Update Partner Dashboard settings to match');
        console.log('4. Ensure Railway environment variables are set');
    }
    
    console.log('\n' + '='.repeat(60));
}

function printPartnerDashboardChecklist() {
    console.log(`\n${colors.blue}${colors.bright}SHOPIFY PARTNER DASHBOARD CHECKLIST${colors.reset}`);
    console.log('Manually verify these settings in your Partner Dashboard:');
    console.log('\n1. App Setup → URLs:');
    console.log(`   □ App URL: ${CORRECT_CONFIG.APP_URL}`);
    console.log('   □ Redirect URLs (all 4):');
    CORRECT_CONFIG.REDIRECT_URLS.forEach(url => {
        console.log(`     - ${url}`);
    });
    console.log('\n2. App Setup → API Access:');
    console.log(`   □ Scopes: ${CORRECT_CONFIG.SCOPES}`);
    console.log('\n3. App Proxy (if using):');
    console.log('   □ Subpath prefix: apps');
    console.log('   □ Subpath: see-it');
    console.log(`   □ URL: ${CORRECT_CONFIG.APP_URL}/app-proxy`);
}

// Main execution
console.log(`${colors.bright}${colors.blue}See It App - Configuration Verification Tool${colors.reset}`);
console.log('='.repeat(60));

// Check all TOML files
checkFile('shopify.app.toml', [
    { name: 'Client ID', key: 'client_id', expected: CORRECT_CONFIG.CLIENT_ID },
    { name: 'App URL', key: 'application_url', expected: CORRECT_CONFIG.APP_URL },
    { name: 'Scopes', section: 'access_scopes', key: 'scopes', expected: CORRECT_CONFIG.SCOPES }
]);

checkFile(path.join('app', 'shopify.app.toml'), [
    { name: 'Client ID', key: 'client_id', expected: CORRECT_CONFIG.CLIENT_ID },
    { name: 'App URL', key: 'application_url', expected: CORRECT_CONFIG.APP_URL },
    { name: 'Scopes', section: 'access_scopes', key: 'scopes', expected: CORRECT_CONFIG.SCOPES }
]);

checkFile(path.join('app', 'shopify.app.see-it.toml'), [
    { name: 'Client ID', key: 'client_id', expected: CORRECT_CONFIG.CLIENT_ID },
    { name: 'App URL', key: 'application_url', expected: CORRECT_CONFIG.APP_URL },
    { name: 'Scopes', section: 'access_scopes', key: 'scopes', expected: CORRECT_CONFIG.SCOPES }
]);

// Check environment variables
checkEnvironmentVariables();

// Check theme extension
checkThemeExtension();

// Print summary
printSummary();

// Print Partner Dashboard checklist
printPartnerDashboardChecklist();

// Exit with appropriate code
process.exit(errors.length > 0 ? 1 : 0);
