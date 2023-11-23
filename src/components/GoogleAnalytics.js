import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import ReactGA from 'react-ga4';

const GoogleAnalytics = ({measurementId}) => {
  const location = useLocation();

  useEffect(() => {
    ReactGA.initialize(measurementId);
  }, [measurementId]);

  useEffect(() => {
    const currentPath = location.pathname + location.search;
    ReactGA.send({hitType: "pageview", page: currentPath});
  }, [location]);

  return null;
};

export const trackEvent = (name, params = {}) => {
  try {
    ReactGA.event(name, params);
  } catch (error) {
    console.error('Error tracking event:', error);
  }
};

export default GoogleAnalytics;