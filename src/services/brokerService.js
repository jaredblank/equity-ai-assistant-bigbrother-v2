// @compliance BIG_BROTHER_V2
const database = require('../config/database');
const logger = require('../utils/logger');
class BrokerService {
    constructor() {
        this.brokerLicense = process.env.BROKER_LICENSE_NUMBER;
        this.defaultMarketArea = process.env.DEFAULT_MARKET_AREA;
        this.propertySearchRadius = parseInt(process.env.PROPERTY_SEARCH_RADIUS) || 25;
        this.mlsAccessToken = process.env.MLS_ACCESS_TOKEN;
    }
    async searchProperties(searchCriteria) {
        const timer = logger.performance('property-search', 'BrokerService');
        try {
            const { location, propertyType = 'residential', minPrice = 0, maxPrice = 10000000, bedrooms, bathrooms, squareFootage, limit = 20, offset = 0 } = searchCriteria;
            let query = `SELECT property_id, address, city, state, zip_code, property_type, listing_price, bedrooms, bathrooms, square_footage, lot_size, year_built, listing_date, status, description, agent_id, images_count, latitude, longitude FROM Properties WHERE status IN ('active', 'pending') AND listing_price BETWEEN @minPrice AND @maxPrice`;
            const params = { minPrice, maxPrice, limit, offset };
            if (propertyType && propertyType !== 'all') { query += ` AND property_type = @propertyType`; params.propertyType = propertyType; }
            if (location) { query += ` AND (city LIKE @location OR state LIKE @location OR zip_code LIKE @location)`; params.location = `%${location}%`; }
            if (bedrooms) { query += ` AND bedrooms >= @bedrooms`; params.bedrooms = bedrooms; }
            if (bathrooms) { query += ` AND bathrooms >= @bathrooms`; params.bathrooms = bathrooms; }
            if (squareFootage) {
                if (squareFootage.min) { query += ` AND square_footage >= @minSquareFootage`; params.minSquareFootage = squareFootage.min; }
                if (squareFootage.max) { query += ` AND square_footage <= @maxSquareFootage`; params.maxSquareFootage = squareFootage.max; }
            }
            query += ` ORDER BY listing_date DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
            const result = await database.executeQuery(query, params, 'property-search');
            const properties = result.recordset.map(prop => ({ propertyId: prop.property_id, address: `${prop.address}, ${prop.city}, ${prop.state} ${prop.zip_code}`, propertyType: prop.property_type, price: prop.listing_price, bedrooms: prop.bedrooms, bathrooms: prop.bathrooms, squareFootage: prop.square_footage, lotSize: prop.lot_size, yearBuilt: prop.year_built, listingDate: prop.listing_date, status: prop.status, description: prop.description, agentId: prop.agent_id, imagesCount: prop.images_count, coordinates: { latitude: prop.locality, longitude: prop.longitude } }));
            timer.addMetadata('propertyCount', properties.length);
            timer.addMetadata('searchCriteria', JSON.stringify(searchCriteria));
            timer.end('Property search completed');
            logger.info('Property search completed', { component: 'BrokerService', propertyCount: properties.length, searchCriteria });
            return { properties, totalFound: properties.length, searchCriteria, timestamp: new Date().toISOString() };
        } catch (error) {
            timer.endWithError(error, 'Property search failed');
            logger.error('Property search failed', { component: 'BrokerService', searchCriteria, error: error.message, stack: error.stack });
            throw error;
        }
    }
    async getMarketAnalysis(location, propertyType = 'residential') {
        const timer = logger.performance('market-analysis', 'BrokerService');
        try {
            const query = `SELECT COUNT(*) as total_listings, AVG(listing_price) as avg_price, MIN(listing_price) as min_price, MAX(listing_price) as max_price, AVG(DATEDIFF(day, listing_date, CASE WHEN status = 'sold' THEN sold_date ELSE GETDATE() END)) as avg_days_on_market, COUNT(CASE WHEN status = 'sold' THEN 1 END) as sold_count, COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count, AVG(square_footage) as avg_square_footage FROM Properties WHERE (city LIKE @location OR state LIKE @location OR zip_code LIKE @location) AND property_type = @propertyType AND listing_date >= DATEADD(month, -6, GETDATE())`;
            const result = await database.executeQuery(query, { location: `%${location}%`, propertyType }, 'market-analysis');
            if (!result.recordset || result.recordset.length === 0) throw new Error('No market data found for the specified location');
            const data = result.recordset[0];
            const marketAnalysis = {
                location, propertyType, totalListings: data.total_listings,
                priceStatistics: { average: Math.round(data.avg_price), minimum: data.min_price, maximum: data.max_price, pricePerSquareFoot: data.avg_square_footage > 0 ? Math.round(data.avg_price / data.avg_square_footage) : null },
                marketActivity: { averageDaysOnMarket: Math.round(data.avg_days_on_market), soldProperties: data.sold_count, activeListings: data.active_count, absorptionRate: data.total_listings > 0 ? Math.round((data.sold_count / data.total_listings) * 100) : 0 },
                averageSquareFootage: Math.round(data.avg_square_footage), analysisDate: new Date().toISOString(), dataRange: 'Last 6 months'
            };
            timer.addMetadata('location', location);
            timer.addMetadata('propertyType', propertyType);
            timer.end('Market analysis completed');
            return marketAnalysis;
        } catch (error) {
            timer.endWithError(error, 'Market analysis failed');
            logger.error('Market analysis failed', { component: 'BrokerService', location, propertyType, error: error.message });
            throw error;
        }
    }
    async scheduleShowing(propertyId, clientInfo, preferredDate, timeSlot = 'afternoon') {
        const timer = logger.performance('schedule-showing', 'BrokerService');
        try {
            const { clientName, clientEmail, clientPhone } = clientInfo;
            const propertyQuery = `SELECT property_id, address, city, state, agent_id, status FROM Properties WHERE property_id = @propertyId AND status IN ('active', 'pending')`;
            const propertyResult = await database.executeQuery(propertyQuery, { propertyId }, 'validate-property');
            if (!propertyResult.recordset || propertyResult.recordset.length === 0) throw new Error('Property not found or not available for showing');
            const property = propertyResult.recordset[0];
            const showingId = require('uuid').v4();
            const insertQuery = `INSERT INTO PropertyShowings (showing_id, property_id, agent_id, client_name, client_email, client_phone, preferred_date, time_slot, status, created_at) VALUES (@showingId, @propertyId, @agentId, @clientName, @clientEmail, @clientPhone, @preferredDate, @timeSlot, 'requested', GETDATE())`;
            await database.executeQuery(insertQuery, { showingId, propertyId, agentId: property.agent_id, clientName, clientEmail, clientPhone, preferredDate, timeSlot }, 'create-showing');
            const showingDetails = { showingId, propertyId, propertyAddress: `${property.address}, ${property.city}, ${property.state}`, clientName, preferredDate, timeSlot, status: 'requested', agentId: property.agent_id, createdAt: new Date().toISOString() };
            timer.addMetadata('propertyId', propertyId);
            timer.addMetadata('showingId', showingId);
            timer.end('Property showing scheduled');
            logger.info('Property showing scheduled', { component: 'BrokerService', showingId, propertyId, clientName, preferredDate });
            return showingDetails;
        } catch (error) {
            timer.endWithError(error, 'Failed to schedule showing');
            logger.error('Failed to schedule showing', { component: 'BrokerService', propertyId, clientInfo, error: error.message });
            throw error;
        }
    }
    async getAgentInfo(agentId = null) {
        const timer = logger.performance('get-agent-info', 'BrokerService');
        try {
            let query = `SELECT agent_id, first_name, last_name, email, phone, license_number, specialties, years_experience, office_address, profile_image, bio, languages, active_listings_count, total_sales_ytd FROM Agents WHERE status = 'active'`;
            const params = {};
            if (agentId) { query += ` AND agent_id = @agentId`; params.agentId = agentId; } else { query += ` AND featured = 1 ORDER BY total_sales_ytd DESC`; }
            const result = await database.executeQuery(query, params, 'get-agent-info');
            const agents = result.recordset.map(agent => ({ agentId: agent.agent_id, name: `${agent.first_name} ${agent.last_name}`, email: agent.email, phone: agent.phone, licenseNumber: agent.license_number, specialties: agent.specialties ? agent.specialties.split(',') : [], yearsExperience: agent.years_experience, officeAddress: agent.office_address, profileImage: agent.profile_image, bio: agent.bio, languages: agent.languages ? agent.languages.split(',') : ['English'], activeListings: agent.active_listings_count, totalSalesYTD: agent.total_sales_ytd }));
            timer.addMetadata('agentCount', agents.length);
            timer.end('Agent information retrieved');
            return agentId ? agents[0] || null : agents;
        } catch (error) {
            timer.endWithError(error, 'Failed to get agent information');
            logger.error('Failed to get agent information', { component: 'BrokerService', agentId, error: error.message });
            throw error;
        }
    }
    async getServiceStats() {
        const timer = logger.performance('get-service-stats', 'BrokerService');
        try {
            const query = `SELECT (SELECT COUNT(*) FROM Properties WHERE status = 'active') as active_listings, (SELECT COUNT(*) FROM Properties WHERE status = 'sold' AND sold_date >= DATEADD(month, -1, GETDATE())) as sold_last_month, (SELECT COUNT(*) FROM PropertyShowings WHERE status = 'requested' AND created_at >= DATEADD(day, -7, GETDATE())) as showings_this_week, (SELECT COUNT(*) FROM Agents WHERE status = 'active') as active_agents, (SELECT AVG(listing_price) FROM Properties WHERE status = 'active') as avg_listing_price`;
            const result = await database.executeQuery(query, {}, 'service-stats');
            const stats = result.recordset[0];
            timer.end('Service statistics retrieved');
            return { activeListings: stats.active_listings, soldLastMonth: stats.sold_last_month, showingsThisWeek: stats.showings_this_week, activeAgents: stats.active_agents, averageListingPrice: Math.round(stats.avg_listing_price), brokerLicense: this.brokerLicense, defaultMarketArea: this.defaultMarketArea, lastUpdated: new Date().toISOString() };
        } catch (error) {
            timer.endWithError(error, 'Failed to get service statistics');
            throw error;
        }
    }
}
module.exports = BrokerService;