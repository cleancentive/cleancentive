import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AdminService } from './admin/admin.service';
const pkg = require('../package.json');

const logger = new Logger('Bootstrap');
const swaggerAuthSchemeName = 'Bearer';
const swaggerTokenStorageKey = 'cleancentive-swagger-session-token';
const swaggerGuestIdStorageKey = 'cleancentive-swagger-guest-id';
const swaggerEmailStorageKey = 'cleancentive-swagger-email';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    // Set global API prefix
    app.setGlobalPrefix('api/v1');

    // Enable CORS for frontend development
    app.enableCors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
      exposedHeaders: ['x-session-token'],
    });

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Cleancentive API')
      .setDescription('REST API for cleanup tracking, authentication, and image analysis workflows.')
      .setVersion(pkg.version)
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Paste an existing Bearer token or use the magic-link flow below.',
        },
        swaggerAuthSchemeName,
      )
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, swaggerDocument, {
      swaggerOptions: {
        persistAuthorization: true,
      },
      customJsStr: `
        (function () {
          var authSchemeName = '${swaggerAuthSchemeName}';
          var storageKey = '${swaggerTokenStorageKey}';
          var guestIdStorageKey = '${swaggerGuestIdStorageKey}';
          var emailStorageKey = '${swaggerEmailStorageKey}';
          var pollTimer = null;
          var initialized = false;
          var modalObserver = null;
          var logoutPatched = false;
          var authStatePoller = null;
          var profileRequest = null;
          var statusState = {
            mode: 'logged-out',
            message: 'Not logged in',
            isError: false,
          };

          function getGuestId() {
            var guestId = localStorage.getItem(guestIdStorageKey);
            if (!guestId) {
              guestId = crypto.randomUUID();
              localStorage.setItem(guestIdStorageKey, guestId);
            }

            return guestId;
          }

          function applyToken(ui, token) {
            if (!token) {
              return;
            }

            localStorage.setItem(storageKey, token);
            ui.preauthorizeApiKey(authSchemeName, token);
          }

          function getAuthorizedToken(ui) {
            if (!ui || !ui.authSelectors || !ui.authSelectors.authorized) {
              return null;
            }

            var authorized = ui.authSelectors.authorized();
            var authMap = authorized && authorized.toJS ? authorized.toJS() : authorized;
            return authMap && authMap[authSchemeName] ? authMap[authSchemeName].value || null : null;
          }

          function clearCookies() {
            document.cookie.split(';').forEach(function (cookie) {
              var separatorIndex = cookie.indexOf('=');
              var name = separatorIndex >= 0 ? cookie.slice(0, separatorIndex).trim() : cookie.trim();
              if (!name) {
                return;
              }

              document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
            });
          }

          function clearToken(ui) {
            localStorage.removeItem(storageKey);
            localStorage.removeItem(guestIdStorageKey);
            localStorage.removeItem(emailStorageKey);
            clearCookies();
            statusState = {
              mode: 'logged-out',
              message: 'Not logged in',
              isError: false,
            };

            if (ui && ui.authActions && ui.authActions.logout) {
              ui.authActions.logout([authSchemeName]);
            }
          }

          function stopPolling() {
            if (pollTimer) {
              window.clearInterval(pollTimer);
              pollTimer = null;
            }
          }

          function getInstructionMessage() {
            return 'Log in with a magic link below, or paste an existing Bearer token.';
          }

          function renderStatus(statusElement) {
            if (!statusElement) {
              return;
            }

            statusElement.textContent = statusState.message;
            statusElement.style.color = statusState.isError ? '#b91c1c' : '#475569';
          }

          function refreshPopupStatus() {
            var statusElement = document.querySelector('#swagger-browser-auth-popup [data-role="browser-auth-status"]');
            if (statusElement) {
              renderStatus(statusElement);
            }
          }

          async function fetchProfileEmail(token) {
            var response = await fetch(buildApiUrl('/user/profile'), {
              headers: {
                Authorization: 'Bearer ' + token,
              },
            });

            if (!response.ok) {
              throw new Error('Failed to load user profile');
            }

            var profile = await response.json();
            if (profile && Array.isArray(profile.emails) && profile.emails.length > 0) {
              var selectedEmail = profile.emails.find(function (entry) {
                return entry && entry.is_selected_for_login;
              });
              return (selectedEmail || profile.emails[0]).email || null;
            }

            return null;
          }

          function updateLoggedInStatus(ui, statusElement) {
            var token = getAuthorizedToken(ui) || localStorage.getItem(storageKey);
            if (!token) {
              localStorage.removeItem(storageKey);
              localStorage.removeItem(emailStorageKey);
              statusState = {
                mode: 'logged-out',
                message: 'Not logged in',
                isError: false,
              };
              renderStatus(statusElement);
              return;
            }

            if (localStorage.getItem(storageKey) !== token) {
              localStorage.setItem(storageKey, token);
            }

            var storedEmail = localStorage.getItem(emailStorageKey);
            if (storedEmail) {
              statusState = {
                mode: 'logged-in',
                message: 'Logged in as ' + storedEmail,
                isError: false,
              };
              renderStatus(statusElement);
              return;
            }

            statusState = {
              mode: 'token-loaded',
              message: 'Bearer token loaded in Swagger.',
              isError: false,
            };
            renderStatus(statusElement);

            if (profileRequest) {
              return;
            }

            profileRequest = fetchProfileEmail(token)
              .then(function (email) {
                if (email) {
                  localStorage.setItem(emailStorageKey, email);
                  statusState = {
                    mode: 'logged-in',
                    message: 'Logged in as ' + email,
                    isError: false,
                  };
                  renderStatus(statusElement);
                }
              })
              .catch(function () {})
              .finally(function () {
                profileRequest = null;
              });
          }

          function startAuthStateSync(ui) {
            if (authStatePoller) {
              return;
            }

            authStatePoller = window.setInterval(function () {
              var statusElement = document.querySelector('#swagger-browser-auth-popup [data-role="browser-auth-status"]');
              if (statusElement && statusState.mode !== 'pending' && statusState.mode !== 'error') {
                updateLoggedInStatus(ui, statusElement);
              }
            }, 1000);
          }

          function patchLogout(ui) {
            if (logoutPatched || !ui || !ui.authActions || !ui.authActions.logout) {
              return;
            }

            var originalLogout = ui.authActions.logout.bind(ui.authActions);
            ui.authActions.logout = function () {
              stopPolling();
              localStorage.removeItem(storageKey);
              localStorage.removeItem(guestIdStorageKey);
              localStorage.removeItem(emailStorageKey);
              clearCookies();
              statusState = {
                mode: 'logged-out',
                message: 'Not logged in',
                isError: false,
              };
              var result = originalLogout.apply(null, arguments);
              window.setTimeout(refreshPopupStatus, 0);
              return result;
            };
            logoutPatched = true;
          }

          function setStatus(statusElement, message, isError) {
            statusState = {
              mode: isError ? 'error' : 'info',
              message: message,
              isError: isError,
            };
            renderStatus(statusElement);
          }

          function buildApiUrl(path) {
            return window.location.origin + '/api/v1' + path;
          }

          function pollPendingAuth(ui, status, requestId) {
            stopPolling();
            statusState = {
              mode: 'pending',
              message: 'Waiting for magic link approval...',
              isError: false,
            };
            renderStatus(status);

            pollTimer = window.setInterval(async function () {
              try {
                var response = await fetch(buildApiUrl('/auth/pending/' + requestId));

                if (response.status === 404) {
                  stopPolling();
                  statusState = {
                    mode: 'error',
                    message: 'Authorization request expired. Send a new magic link.',
                    isError: true,
                  };
                  renderStatus(status);
                  return;
                }

                if (!response.ok) {
                  throw new Error('Polling failed');
                }

                var payload = await response.json();
                if (payload.status === 'completed' && payload.sessionToken) {
                  stopPolling();
                  applyToken(ui, payload.sessionToken);
                  updateLoggedInStatus(ui, status);
                }
              } catch (error) {
                statusState = {
                  mode: 'pending',
                  message: 'Waiting for magic link approval...',
                  isError: false,
                };
                renderStatus(status);
              }
            }, 2000);
          }

          function createPopupPanel(ui) {
            var form = document.querySelector('.dialog-ux .auth-container form');
            if (!form || document.getElementById('swagger-browser-auth-popup')) {
              return;
            }

            var schemeBlock = form.querySelector('form > div, div');
            var buttonRow = form.querySelector('.auth-btn-wrapper');
            var schemeTitle = form.querySelector('h4 code');
            var markdownDescription = form.querySelector('.renderedMarkdown');
            var valueWrapper = form.querySelector('.wrapper:has(#auth-bearer-value)');
            var applyButton = form.querySelector('button.authorize');

            if (schemeTitle) {
              schemeTitle.textContent = 'Bearer token';
            }

            if (markdownDescription && markdownDescription.parentElement) {
              markdownDescription.parentElement.style.display = 'none';
            }

            if (applyButton) {
              applyButton.textContent = 'Use token';
              applyButton.setAttribute('aria-label', 'Use token');
            }

            var container = document.createElement('div');
            container.id = 'swagger-browser-auth-popup';
            container.style.margin = '16px 0';
            container.style.display = 'grid';
            container.style.gap = '12px';

            var statusBlock = document.createElement('div');
            var statusLabel = document.createElement('div');
            statusLabel.textContent = 'Status';
            statusLabel.style.fontWeight = '600';
            statusLabel.style.fontSize = '13px';
            statusLabel.style.margin = '0 0 4px';

            var description = document.createElement('p');
            description.textContent = getInstructionMessage();
            description.style.margin = '0';
            description.style.color = '#475569';
            description.style.fontSize = '14px';

            var magicLinkBlock = document.createElement('div');
            var magicLinkLabel = document.createElement('div');
            magicLinkLabel.textContent = 'Magic link';
            magicLinkLabel.style.fontWeight = '600';
            magicLinkLabel.style.fontSize = '13px';
            magicLinkLabel.style.margin = '0 0 4px';

            var tokenBlock = document.createElement('div');
            var tokenLabel = document.createElement('div');
            tokenLabel.textContent = 'Bearer token';
            tokenLabel.style.fontWeight = '600';
            tokenLabel.style.fontSize = '13px';
            tokenLabel.style.margin = '0 0 4px';

            var controls = document.createElement('div');
            controls.style.display = 'flex';
            controls.style.gap = '8px';
            controls.style.flexWrap = 'wrap';
            controls.style.alignItems = 'center';

            var emailInput = document.createElement('input');
            emailInput.type = 'email';
            emailInput.placeholder = 'you@example.com';
            emailInput.value = localStorage.getItem(emailStorageKey) || '';
            emailInput.style.minWidth = '260px';
            emailInput.style.padding = '6px 8px';
            emailInput.style.border = '1px solid #cbd5e1';
            emailInput.style.borderRadius = '4px';

            var sendButton = document.createElement('button');
            sendButton.type = 'button';
            sendButton.textContent = 'Send magic link';
            sendButton.className = 'btn modal-btn auth';

            var status = document.createElement('p');
            status.setAttribute('data-role', 'browser-auth-status');
            status.style.margin = '0';
            status.style.fontSize = '13px';
            renderStatus(status);

            sendButton.addEventListener('click', async function () {
              var email = emailInput.value.trim();
              if (!email) {
                setStatus(status, 'Enter an email address first.', true);
                return;
              }

              sendButton.disabled = true;
              setStatus(status, 'Sending magic link...', false);
              localStorage.setItem(emailStorageKey, email);

              try {
                var response = await fetch(buildApiUrl('/auth/magic-link'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ email: email, guestId: getGuestId() }),
                });

                if (!response.ok) {
                  throw new Error('Failed to send magic link');
                }

                var payload = await response.json();
                if (!payload.requestId) {
                  throw new Error('Missing request id');
                }

                setStatus(status, 'Magic link sent. Check your email, then open the link in the frontend.', false);
                pollPendingAuth(ui, status, payload.requestId);
              } catch (error) {
                stopPolling();
                setStatus(status, 'Failed to send magic link.', true);
              } finally {
                sendButton.disabled = false;
              }
            });

            controls.appendChild(emailInput);
            controls.appendChild(sendButton);
            statusBlock.appendChild(statusLabel);
            statusBlock.appendChild(status);
            magicLinkBlock.appendChild(magicLinkLabel);
            magicLinkBlock.appendChild(controls);
            tokenBlock.appendChild(tokenLabel);

            container.appendChild(statusBlock);
            container.appendChild(description);
            container.appendChild(magicLinkBlock);

            if (valueWrapper) {
              tokenBlock.appendChild(valueWrapper);
            }

            if (buttonRow && applyButton) {
              tokenBlock.appendChild(buttonRow);
            }

            container.appendChild(tokenBlock);

            if (schemeBlock) {
              form.insertBefore(container, schemeBlock);
              if (schemeBlock.parentElement) {
                schemeBlock.style.display = 'none';
              }
            } else {
              form.appendChild(container);
            }
          }

          function syncAuthUi(ui) {
            patchLogout(ui);

            var existingToken = localStorage.getItem(storageKey);
            if (existingToken) {
              applyToken(ui, existingToken);
            }

            var oldInlinePanel = document.getElementById('swagger-browser-auth');
            if (oldInlinePanel) {
              oldInlinePanel.remove();
            }

            createPopupPanel(ui);
          }

          function initialize() {
            if (initialized) {
              return;
            }

            var ui = window.ui;
            if (!ui || !document.querySelector('.swagger-ui')) {
              window.setTimeout(initialize, 250);
              return;
            }

            initialized = true;

            syncAuthUi(ui);
            startAuthStateSync(ui);

            modalObserver = new MutationObserver(function () {
              syncAuthUi(ui);
            });
            modalObserver.observe(document.body, { childList: true, subtree: true });
          }

          initialize();
        })();
      `,
    });

    // Ensure ADMIN_EMAILS users are promoted on startup
    const adminService = app.get(AdminService);
    await adminService.ensureAdminEmailsPromoted();

    const port = process.env.API_PORT || 3000;
    await app.listen(port);

    logger.log(`🚀 Application is running on: http://localhost:${port}/api/v1`);
    logger.log(`📘 Swagger UI is running on: http://localhost:${port}/api/v1/docs`);
    logger.log(`📧 Email service: SMTP (check Mailpit at http://localhost:8025 for dev)`);
  } catch (error) {
    logger.error('Failed to start application');
    
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('connect')) {
      logger.error('');
      logger.error('❌ Cannot connect to required services (PostgreSQL, Redis, etc.)');
      logger.error('');
      logger.error('💡 Start Docker services first:');
      logger.error('   cd infrastructure && docker compose -f docker-compose.dev.yml up -d');
      logger.error('   or run: bun run dev:infra:start');
      logger.error('');
      logger.error('📋 Check service status:');
      logger.error('   docker compose -f infrastructure/docker-compose.dev.yml ps');
      logger.error('');
    } else {
      logger.error(error.message);
      logger.error(error.stack);
    }
    
    process.exit(1);
  }
}

bootstrap();
