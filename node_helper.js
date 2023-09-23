

async function handleFetchCalendarsWithRefresh() {
  try {
      // Attempt to fetch calendars using the current access token.
      return await fetchCalendars.call(this);
  } catch (error) {
      // Check if error indicates expired token (e.g., error code or message suggesting unauthorized access)
      if (error.response && error.response.status === 401) {
          try {
              // Attempt to refresh the token
              await refreshAccessToken(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
              
              // Retry fetching calendars
              return await fetchCalendars.call(this);
          } catch (refreshError) {
              // Handle refresh token error or re-authentication
              Log.error("Error refreshing the token:", refreshError);
              throw refreshError;
          }
      } else {
          // Handle other API errors
          Log.error("API call error:", error);
          throw error;
      }
  }
}
const NodeHelper = require("node_helper");
const { google } = require("googleapis");
const { encodeQueryData } = require("./helpers");
const fs = require("fs");
const Log = require("logger");
const {OAuth2Client} = require('google-auth-library');
const sixtyDaysAgo = new Date();
sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

const TOKEN_PATH = "/token.json";

async function refreshAccessToken(credentials) {
  const client = new OAuth2Client(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uris ? credentials.redirect_uris[0] : undefined
  );
  
  client.setCredentials({
      refresh_token: credentials.refresh_token
  });
  
  const newTokens = await client.refreshAccessToken();
  const newAccessToken = newTokens.credentials.access_token;
  
  // Save the new access token to token.json
  credentials.access_token = newAccessToken;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
  
  return newAccessToken;
}


module.exports = NodeHelper.create({
// Override start method.
start: function () {
  Log.log("Starting node helper for: " + this.name);
  this.fetchers = [];
  this.isHelperActive = true;

  this.calendarService;
},

stop: function () {
  this.isHelperActive = false;
},

// Override socketNotificationReceived method.
socketNotificationReceived: function (notification, payload) {
  if (notification === "MODULE_READY") {
    if (!this.calendarService) {
      if (payload.queryParams) {
        // if payload is sent, user has authenticated
        const params = new URLSearchParams(payload.queryParams);
        this.authenticateWithQueryParams(params);
      } else {
        this.authenticate();
      }
    } else {
      this.sendSocketNotification("SERVICE_READY", {});
    }
  }
  if (notification === "ADD_CALENDAR") {
    this.fetchCalendar(
      payload.calendarID,
      payload.fetchInterval,
      payload.maximumEntries,
      payload.id
    );
  }
},

authenticateWithQueryParams: function (params) {
  const error = params.get("error");
  if (error) {
    this.sendSocketNotification("AUTH_FAILED", { error_type: error });
    return;
  }

  var _this = this;
  const code = params.get("code");

  fs.readFile(_this.path + "/credentials.json", (err, content) => {
    if (err) {
      _this.sendSocketNotification("AUTH_FAILED", { error_type: err });
      return console.log("Error loading client secret file:", err);
    }
    // Authorize a client with credentials, then call the Google Tasks API.
    _this.authenticateWeb(
      _this,
      code,
      JSON.parse(content),
      _this.startCalendarService
    );
  });
},

// replaces the old authenticate method
authenticateWeb: function (_this, code, credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.web;

  if (!client_secret || !client_id) {
    _this.sendSocketNotification("AUTH_FAILED", {
      error_type: "WRONG_CREDENTIALS_FORMAT"
    });
    return;
  }

  _this.oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris ? redirect_uris[0] : "http://localhost:8080"
  );

  _this.oAuth2Client.getToken(code, (err, token) => {
    if (err) return console.error("Error retrieving access token", err);
    _this.oAuth2Client.setCredentials(token);
    // Store the token to disk for later program executions
    fs.writeFile(_this.path + TOKEN_PATH, JSON.stringify(token), (err) => {
      if (err) return console.error(err);
      console.log("Token stored to", _this.path + TOKEN_PATH);
    });
    callback(_this.oAuth2Client, _this);
  });
},

// Authenticate oAuth credentials
authenticate: function () {
  var _this = this;

  fs.readFile(_this.path + "/credentials.json", (err, content) => {
    if (err) {
      _this.sendSocketNotification("AUTH_FAILED", { error_type: err });
      return console.log("Error loading client secret file:", err);
    }
    // Authorize a client with credentials, then call the Google Tasks API.
    authorize(JSON.parse(content), _this.startCalendarService);
  });

  /**
   * Create an OAuth2 client with the given credentials, and then execute the
   * given callback function.
   * @param {Object} credentials The authorization client credentials.
   * @param {function} callback The callback to call with the authorized client.
   */
  function authorize(credentials, callback) {
    var creds;
    var credentialType;

    // TVs and Limited Input devices credentials
    if (credentials.installed) {
      creds = credentials.installed;
      credentialType = "tv";
    }

    // Web credentials (fallback)
    if (credentials.web) {
      creds = credentials.web;
      credentialType = "web";
    }

    const { client_secret, client_id, redirect_uris } = creds;

    if (!client_secret || !client_id) {
      _this.sendSocketNotification("AUTH_FAILED", {
        error_type: "WRONG_CREDENTIALS_FORMAT"
      });
      return;
    }

    _this.oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris ? redirect_uris[0] : "http://localhost:8080"
    );

    // Check if we have previously stored a token.
    fs.readFile(_this.path + TOKEN_PATH, (err, token) => {
      if (err) {
        const redirect_uri = redirect_uris
          ? redirect_uris[0]
          : `http://localhost:8080`;

        // alert auth is needed
        _this.sendSocketNotification("AUTH_NEEDED", {
          url: `https://accounts.google.com/o/oauth2/v2/auth?${encodeQueryData(
            {
              scope: "https://www.googleapis.com/auth/calendar.readonly",
              access_type: "offline",
              include_granted_scopes: true,
              response_type: "code",
              state: _this.name,
              redirect_uri,
              client_id
            }
          )}`, // only used for web credential
          credentialType
        });

        return console.log(
          this.name + ": Error loading token:",
          err,
          "Make sure you have authorized the app."
        );
      }
      _this.oAuth2Client.setCredentials(JSON.parse(token));
      callback(_this.oAuth2Client, _this);
    });
  }
},

/**
 * Check for data.error
 * @param {object} error
 */
checkForHTTPError: function(request) {
return request?.response?.data?.error?.toUpperCase();
},

startCalendarService: function (auth, _this) {
  _this.calendarService = google.calendar({ version: "v3", auth });
  _this.sendSocketNotification("SERVICE_READY", {});
},

/**
 * Fetch calendars
 *
 * @param {string} calendarID The ID of the calendar
 * @param {number} fetchInterval How often does the calendar needs to be fetched in ms
 * @param {number} maximumEntries The maximum number of events fetched.
 * @param {string} identifier ID of the module
 */
fetchCalendar: function (
  calendarID,
  fetchInterval,
  maximumEntries,
  identifier
) {
  this.calendarService.events.list(
    {
      calendarId: calendarID,
      timeMin: sixtyDaysAgo.toISOString(),
      maxResults: maximumEntries,
      singleEvents: true,
      orderBy: "startTime"
    },
    (err, res) => {
      if (err) {
        Log.error(
          "MMM-GoogleCalendar Error. Could not fetch calendar: ",
          calendarID,
          err
        );
        let error_type = NodeHelper.checkFetchError(err);
    if (error_type === 'MODULE_ERROR_UNSPECIFIED') {
      error_type = this.checkForHTTPError(err) || error_type;
    }

    // send error to module
        this.sendSocketNotification("CALENDAR_ERROR", {
          id: identifier,
          error_type
        });
      } else {
        const events = res.data.items;
        Log.info(
          `${this.name}: ${events.length} events loaded for ${calendarID}`
        );
        this.broadcastEvents(events, identifier, calendarID); 
      }
      
      this.scheduleNextCalendarFetch(
        calendarID,
        fetchInterval,
        maximumEntries,
        identifier
      );
    }
  );
},

scheduleNextCalendarFetch: function (
  calendarID,
  fetchInterval,
  maximumEntries,
  identifier
) {
  var _this = this;
  if (this.isHelperActive) {
    setTimeout(function () {
      _this.fetchCalendar(
        calendarID,
        fetchInterval,
        maximumEntries,
        identifier
      );
    }, fetchInterval);
  }
},

broadcastEvents: function (googleEvents, identifier, calendarID) {
  const transformedEvents = googleEvents.map(event => ({
      ...event,
      title: event.summary,
      startDate: event.start.date 
      ? new Date(new Date(event.start.date).getTime() + new Date().getTimezoneOffset() * 60000 + 12*3600*1000).getTime() 
      : new Date(event.start.dateTime).getTime(),
  
  endDate: event.end.date 
      ? (new Date(event.start.date).getTime() === new Date(event.end.date).getTime() - 86400000)
          ? new Date(new Date(event.start.date).getTime() + new Date().getTimezoneOffset() * 60000 + 12*3600*1000).getTime() 
          : new Date(new Date(event.end.date).getTime() - 86400000 + new Date().getTimezoneOffset() * 60000 + 11*3600*1000).getTime()
      : new Date(event.end.dateTime).getTime(),
  
  
  
      fullDayEvent: event.start.date ? true : false,
      class: undefined,
      geo: false, // Assuming geo information is not available
  }));

  this.sendSocketNotification("CALENDAR_EVENTS", {
      id: identifier,
      calendarID,
      events: transformedEvents
  });
}




/*
broadcastEvents: function (events, identifier, calendarID) {
  console.log("Broadcasting Events:", events);  // This line will print the events to the console
  this.sendSocketNotification("CALENDAR_EVENTS", {
    id: identifier,
    calendarID,
    events: events
  });
}*/
});


