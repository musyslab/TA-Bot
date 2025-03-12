import styled from 'styled-components';
import 'semantic-ui-css/semantic.min.css';
import { Icon } from 'semantic-ui-react';

// Apply a cast to make sure the Icon component works with styled-components
export const StyledIcon = styled(Icon as any)`
  margin: 0 !important;
`;

export {}; // Add this to resolve the TypeScript isolated modules issue
