
from main import play_rps_game
from schemas import RPSGameRequest
from models import User
import pytest
from unittest.mock import MagicMock

def test_rps_logic():
    # Setup
    mock_db = MagicMock()
    mock_user = User(id=1, username="test", credit_balance=1000)
    
    # Request: Bet 100, Pick Rock
    req = RPSGameRequest(bet_amount=100, choice="ROCK")
    
    # We need to control the random choice to ensure WIN
    # Since we can't easily mock random inside the function without patching,
    # we will run it multiple times or patch random.
    
    import random
    original_choice = random.choice
    
    # Force server to choose SCISSORS (Lose to Rock) -> User WINS
    random.choice = lambda x: "SCISSORS" 
    
    try:
        response = play_rps_game(req, mock_user, mock_db)
        print(f"Response: {response}")
        
        # Check Math
        # Bet 100. Fee 10. Win 90.
        expected_change = 90
        assert response["credit_change"] == expected_change
        assert response["result"] == "WIN"
        assert mock_user.credit_balance == 1000 + 90
        
        print("WIN Logic Verified: OK")
        
    finally:
        random.choice = original_choice

if __name__ == "__main__":
    test_rps_logic()
