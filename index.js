// ISC License
// Original work Copyright (c) 2017, Andreas Bauer
// Modified work Copyright 2020, Sander van Woensel

"use strict";

// -----------------------------------------------------------------------------
// Module variables
// -----------------------------------------------------------------------------
let Service, Characteristic, api;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const configParser = require("homebridge-http-base").configParser;
const http = require("homebridge-http-base").http;
const https = require('https');
const PullTimer = require("homebridge-http-base").PullTimer;
const xml2js = require('xml2js');

const parser = new xml2js.Parser({ attrkey: "ATTR" });

const PACKAGE_JSON = require('./package.json');
const FIRMWARE_REVISION = PACKAGE_JSON.version;


// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    api = homebridge;

    homebridge.registerAccessory(MODEL, "SolarEdgeAPI", SolarEdgeAPI);
};

// -----------------------------------------------------------------------------
// Module public functions
// -----------------------------------------------------------------------------

function SolarEdgeAPI(log, config) {
    this.log = log;
    this.name = config.name;
	this.siteID = config.siteID;
	this.APIsecret = config.APIsecret;

    this.currentUsage = 0;
	this.getCurrentUsageUrl = "https://monitoringapi.solaredge.com/site/"+siteID+"/overview?api_key="+APIsecret
	this.getSiteInfoUrl = "https://monitoringapi.solaredge.com/equipment/"+siteID+"/list?api_key="+APIsecret

    this.validateUrl = function(url, mandatory=false) {
        if (url) {
            try {
                this[url] = configParser.parseUrlProperty(url);
            } catch (error) {
                this.log.warn("Error occurred while parsing '"+url+"': " + error.message);
                this.log.warn("Aborting...");
                return;
            }
        }
        else if(mandatory) {
            this.log.warn("Property '"+url+"' is required!");
            this.log.warn("Aborting...");
            return;
        }
    };

    this.validateUrl(getCurrentUsageUrl, true);
    this.validateUrl(getSiteInfoUrl, true);
    this.homebridgeService = new Service.LightSensor(this.name);
    
    if (config.pullInterval) {
        this.pullTimer = new PullTimer(log, config.pullInterval, this.getCurrentUsage.bind(this), value => {
            this.homebridgeService.setCharacteristic(Characteristic.CurrentAmbientLightLevel, value);
        });
        this.pullTimer.start();
    }

    api.on('didFinishLaunching', function() {}.bind(this));
}

SolarEdgeAPI.prototype = {

    getServices: function () {
        const informationService = new Service.AccessoryInformation();

		let req = https.get(getSiteInfoUrl, function(res) {
			let xml_data  = '';
			res.on('data', (stream) => {
				xml_data = xml_data + stream;
			});
			res.on('end', () => {
				parser.parseString(xml_data, (error, result) => {
					if(error === null) {
						if(result['equipmentList']['list'][0]){
							informationService
								.setCharacteristic(Characteristic.Manufacturer, result['equipmentList']['list'][0]['manufacturer'])
								.setCharacteristic(Characteristic.Model, result['equipmentList']['list'][0]['model'])
								.setCharacteristic(Characteristic.SerialNumber, result['equipmentList']['list'][0]['serialNumber'])
								.setCharacteristic(Characteristic.FirmwareRevision, FIRMWARE_REVISION);
						}
						else {
							this.log.error("Couldn't parse inverter information: "+result);
						}
					}
					else {
						this.log.error("Couldn't fetch inverter information: '"+error+"'");
					}
				});
			});
		});

        this.homebridgeService
            .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
            .on("get", this.getCurrentUsage.bind(this));

        return [informationService, this.homebridgeService];
    },

    handleNotification: function(body) {
        const value = body.value;

        let characteristic;
        switch (body.characteristic) {
            case "CurrentAmbientLightLevel":
                characteristic = Characteristic.CurrentAmbientLightLevel;
                break;
            default:
                this.log.warn("Encountered unknown characteristic handling notification: " + body.characteristic);
                return;
        }

        this.log.debug("Update received from device: " + body.characteristic + ": " + body.value);
        this.homebridgeService.setCharacteristic(characteristic, value);
    },

    getCurrentUsage: function (callback) {
		
		let req = https.get(getSiteInfoUrl, function(res) {
            if (this.pullTimer)
                this.pullTimer.resetTimer();
			
			let xml_data  = '';
			res.on('data', (stream) => {
				xml_data = xml_data + stream;
			});
			res.on('end', () => {
				parser.parseString(xml_data, (error, result) => {
					if(error === null) {
						if(result['overview']['currentPower']['power']){
							this.log.info("Current usage (retrieved via http): %s\%", result['overview']['currentPower']['power']);
							callback(null, result['overview']['currentPower']['power']);
						}
						else {
							this.log.error("getCurrentUsage() Couldn't parse current power information: "+result);
						}
					}
					else {
						this.log.error("getCurrentUsage() failed: %s", error);
						callback(error);
					}
				});
			});
		});
    }
};
