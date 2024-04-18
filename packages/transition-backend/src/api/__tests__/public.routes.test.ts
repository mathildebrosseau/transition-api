/*
 * Copyright 2024, Polytechnique Montreal and contributors
 *
 * This file is licensed under the MIT License.
 * License text available at https://opensource.org/licenses/MIT
 */
import express, { RequestHandler } from 'express';
import publicRoutes from '../public.routes';
import passport from 'passport'
import request from 'supertest';
import transitObjectDataHandlers from '../../services/transitObjects/TransitObjectsDataHandler';
import osrmProcessManager from 'chaire-lib-backend/lib/utils/processManagers/OSRMProcessManager';
import tokensDbQueries from 'chaire-lib-backend/lib/models/db/tokens.db.queries';
import TrError from 'chaire-lib-common/lib/utils/TrError';
import { calculateAccessibilityMap, calculateRoute } from '../../services/routingCalculation/RoutingCalculator';
import * as Status from 'chaire-lib-common/lib/utils/Status';
import TransitAccessibilityMapRouting from 'transition-common/lib/services/accessibilityMap/TransitAccessibilityMapRouting';
import TransitRouting from 'transition-common/lib/services/transitRouting/TransitRouting';

jest.mock('../../services/routingCalculation/RoutingCalculator');
jest.mock('transition-common/lib/services/accessibilityMap/TransitAccessibilityMapRouting');
jest.mock('transition-common/lib/services/transitRouting/TransitRouting');
jest.mock('passport');

const app = express();
app.use(express.json() as RequestHandler);
publicRoutes(app, passport);

beforeEach(() => {
    jest.clearAllMocks();

    (passport.authenticate as jest.Mock).mockImplementation(() => {
        return (req, res, next) => {
            next();
        };
    });
});

describe('Testing POST /token endpoint', () => {
    test('POST /token', async () => {
        tokensDbQueries.getOrCreate = jest.fn(() => Promise.resolve()) as any;

        const body = {
            usernameOrEmail: 'testuser',
            password: 'testpassword'
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(200);
        expect(tokensDbQueries.getOrCreate).toHaveBeenCalledWith(body.usernameOrEmail);
    });

    test('POST /token, should return 500 when DB error', async () => {
        tokensDbQueries.getOrCreate = jest.fn(() => { throw new TrError('This is an error', 'ERRORCODE') }) as any;

        const body = {
            usernameOrEmail: 'testuser',
            password: 'testpassword'
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(500);
        expect(tokensDbQueries.getOrCreate).toHaveBeenCalledWith(body.usernameOrEmail);
    });

    test('POST /token, should return 400 with empty user', async () => {
        tokensDbQueries.getOrCreate = jest.fn(() => Promise.resolve()) as any;
        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback();
            }
        });

        const body = {
            usernameOrEmail: '',
            password: 'testpassword'
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(400);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });

    test('POST /token, should return 400 with missing user', async () => {
        tokensDbQueries.getOrCreate = jest.fn(() => Promise.resolve()) as any;
        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback();
            }
        });

        const body = {
            password: 'testpassword'
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(400);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });

    test('POST /token, should return 400 with empty password', async () => {
        tokensDbQueries.getOrCreate = jest.fn(() => Promise.resolve()) as any;
        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback();
            }
        });

        const body = {
            usernameOrEmail: 'testuser',
            password: ''
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(400);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });

    test('POST /token, should return 400 with missing password', async () => {
        tokensDbQueries.getOrCreate = jest.fn(() => Promise.resolve()) as any;
        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback();
            }
        });

        const body = {
            usernameOrEmail: 'testuser'
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(400);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });

    test('POST /token, should return 401 when unknown user', async () => {
        const error = 'UnknownUser';

        tokensDbQueries.getOrCreate = jest.fn(() => Promise.resolve()) as any;
        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback(error);
            }
        });

        const body = {
            usernameOrEmail: 'testuser',
            password: 'testpassword'
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(401);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });

    test('POST /token, should return 401 when password does not match', async () => {
        const error = 'PasswordsDontMatch';

        tokensDbQueries.getOrCreate = jest.fn(() => Promise.resolve()) as any;
        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback(error);
            }
        });

        const body = {
            usernameOrEmail: 'testuser',
            password: 'testpassword'
        };
        const response = await request(app)
            .post('/token')
            .send(body);

        expect(response.status).toStrictEqual(401);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });
});

describe('Testing passport bearer-strategy middleware', () => {
    test('Should return 401 when token is expired', async () => {
        const error = 'DatabaseTokenExpired';

        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback(error);
            }
        });

        const response = await request(app).get('/api');

        expect(response.status).toEqual(401);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });

    test('Should return 401 when token is invalid', async () => {
        const error1 = 'DatabaseNoUserMatchesProvidedToken';
        const error2 = 'DatabaseNoUserMatchesToken';
        const error3 = 'InvalidToken';

        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback(error1);
            }
        });

        const response1 = await request(app).get('/api');

        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback(error2);
            }
        });

        const response2 = await request(app).get('/api');

        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback(error3);
            }
        });

        const response3 = await request(app).get('/api');

        expect(response1.status).toEqual(401);
        expect(response2.status).toEqual(401);
        expect(response3.status).toEqual(401);
        expect(passport.authenticate).toHaveBeenCalledTimes(3);
    });

    test('Should return 500 when other error is encountered', async () => {
        const error = 'testerror';

        (passport.authenticate as jest.Mock).mockImplementation((strategy, options, callback) => {
            return () => {
                callback(error);
            }
        });

        const response = await request(app).get('/api');

        expect(response.status).toEqual(500);
        expect(passport.authenticate).toHaveBeenCalledTimes(1);
    });
});

describe('Testing API endpoints', () => {
    test('GET /api/paths', async () => {
        const pathsGeojson = 'pathsGeojson';

        transitObjectDataHandlers.paths.geojsonCollection! = jest.fn().mockResolvedValue(
            Status.createOk({
                type: 'geojson',
                geojson: pathsGeojson
            })
        );

        const response = await request(app).get('/api/paths');

        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(pathsGeojson);
        expect(transitObjectDataHandlers.paths.geojsonCollection!).toBeCalled();
    });

    test('GET /api/nodes', async () => {
        const nodesGeojson = 'nodesGeojson';
        
        transitObjectDataHandlers.nodes.geojsonCollection! = jest.fn().mockResolvedValue(
            Status.createOk({
                type: 'geojson',
                geojson: nodesGeojson
            })
        );

        const response = await request(app).get('/api/nodes');

        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(nodesGeojson);
        expect(transitObjectDataHandlers.nodes.geojsonCollection!).toBeCalled();
    });

    test('GET /api/scenarios', async () => {
        const result = 'scenariosResult';

        transitObjectDataHandlers.scenarios.collection! = jest.fn().mockResolvedValue(result);

        const response = await request(app).get('/api/scenarios');
        
        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(result);
        expect(transitObjectDataHandlers.scenarios.collection!).toBeCalledWith(null);
    });

    test('GET /api/routing-modes', async () => {
        osrmProcessManager.availableRoutingModes = jest.fn().mockResolvedValue([]);

        const response = await request(app).get('/api/routing-modes');

        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(['transit']);
        expect(osrmProcessManager.availableRoutingModes).toBeCalled();
    });

    test('POST /api/accessibility, without geojson', async () => {
        const attributes = { locationGeojson: 'value' };
        const result = 'result';

        const mockTransitAccessibilityMapRouting = {
            validate: () => true
        };

        (calculateAccessibilityMap as jest.Mock).mockResolvedValue(result);
        (TransitAccessibilityMapRouting as any).mockImplementation(() => mockTransitAccessibilityMapRouting);

        const response = await request(app)
            .post('/api/accessibility?withGeojson=false')
            .send(attributes);

        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(result);
        expect(calculateAccessibilityMap).toBeCalledWith(mockTransitAccessibilityMapRouting, false);
    });

    test('POST /api/accessibility, with geojson', async () => {
        const attributes = { locationGeojson: 'value' };
        const result = 'result';

        const mockTransitAccessibilityMapRouting = {
            validate: () => true
        };

        (calculateAccessibilityMap as jest.Mock).mockResolvedValue(result);
        (TransitAccessibilityMapRouting as any).mockImplementation(() => mockTransitAccessibilityMapRouting);

        const response = await request(app)
            .post('/api/accessibility?withGeojson=true')
            .send(attributes);

        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(result);
        expect(calculateAccessibilityMap).toBeCalledWith(mockTransitAccessibilityMapRouting, true);
    });

    test('POST /api/accessibility, without locationGeojson', async () => {
        const attributes = { notLocationGeojson: 'value' };

        const response = await request(app)
            .post('/api/accessibility')
            .send(attributes);

        expect(response.status).toStrictEqual(400);
        expect(calculateAccessibilityMap).toBeCalledTimes(0);
    });

    test('POST /api/accessibility, routing validation fails', async () => {
        const attributes = { locationGeojson: 'value' };

        const mockTransitAccessibilityMapRouting = {
            validate: () => false,
            errors: []
        };

        (TransitAccessibilityMapRouting as any).mockImplementation(() => mockTransitAccessibilityMapRouting);

        const response = await request(app)
            .post('/api/accessibility?withGeojson=true')
            .send(attributes);

        expect(response.status).toStrictEqual(400);
        expect(calculateAccessibilityMap).toBeCalledTimes(0);
    });

    test('POST /api/accessibility, with error', async () => {
        const attributes = { locationGeojson: 'value' };

        const mockTransitAccessibilityMapRouting = {
            validate: () => true
        };

        (calculateAccessibilityMap as jest.Mock).mockImplementation(() => {
            throw new Error();
        });
        (TransitAccessibilityMapRouting as any).mockImplementation(() => mockTransitAccessibilityMapRouting);

        const response = await request(app)
            .post('/api/accessibility')
            .send(attributes);

        expect(response.status).toStrictEqual(500);
        expect(calculateAccessibilityMap).toBeCalled();
    });

    test('POST /api/route, without geojson', async () => {
        const result = 'result';

        const mockTransitRouting = {
            originDestinationToGeojson: () => ({
                features: {
                    length: 2
                }
            }),
            validate: () => true
        };

        (calculateRoute as jest.Mock).mockResolvedValue(result);
        (TransitRouting as any).mockImplementation(() => mockTransitRouting);

        const response = await request(app).post('/api/route?withGeojson=false');

        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(result);
        expect(calculateRoute).toBeCalledWith(mockTransitRouting, false);
    });

    test('POST /api/route, with geojson', async () => {
        const result = 'result';

        const mockTransitRouting = {
            originDestinationToGeojson: () => ({
                features: {
                    length: 2
                }
            }),
            validate: () => true
        };

        (calculateRoute as jest.Mock).mockResolvedValue(result);
        (TransitRouting as any).mockImplementation(() => mockTransitRouting);

        const response = await request(app).post('/api/route?withGeojson=true');

        expect(response.status).toStrictEqual(200);
        expect(response.body).toStrictEqual(result);
        expect(calculateRoute).toBeCalledWith(mockTransitRouting, true);
    });

    test('POST /api/route, without origin/destination', async () => {
        const mockTransitRouting = {
            originDestinationToGeojson: () => ({
                features: {
                    length: 0
                }
            })
        };

        (TransitRouting as any).mockImplementation(() => mockTransitRouting);

        const response = await request(app).post('/api/route');

        expect(response.status).toStrictEqual(400);
        expect(calculateRoute).toBeCalledTimes(0);
    });

    test('POST /api/route, routing validation fails', async () => {
        const mockTransitRouting = {
            originDestinationToGeojson: () => ({
                features: {
                    length: 2
                }
            }),
            validate: () => false,
            errors: []
        };

        (TransitRouting as any).mockImplementation(() => mockTransitRouting);

        const response = await request(app).post('/api/route');

        expect(response.status).toStrictEqual(400);
        expect(calculateRoute).toBeCalledTimes(0);
    });

    test('POST /api/route, with error', async () => {
        const mockTransitRouting = {
            originDestinationToGeojson: () => ({
                features: {
                    length: 2
                }
            }),
            validate: () => true
        };

        (calculateRoute as jest.Mock).mockImplementation(() => {
            throw new Error();
        });
        (TransitRouting as any).mockImplementation(() => mockTransitRouting);

        const response = await request(app).post('/api/route');

        expect(response.status).toStrictEqual(500);
        expect(calculateRoute).toBeCalled();
    });
});
